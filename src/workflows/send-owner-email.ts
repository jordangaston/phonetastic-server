import { DBOS, WorkflowQueue } from '@dbos-inc/dbos-sdk';
import { container } from 'tsyringe';
import type { EmailRepository } from '../repositories/email-repository.js';
import type { ChatRepository } from '../repositories/chat-repository.js';
import type { CompanyRepository } from '../repositories/company-repository.js';
import type { EndUserRepository } from '../repositories/end-user-repository.js';
import type { ResendService } from '../services/resend-service.js';

export const sendOwnerEmailQueue = new WorkflowQueue('send-owner-email');

/**
 * DBOS workflow that sends an owner's reply email via Resend.
 */
export class SendOwnerEmail {
  /**
   * Orchestrates owner email sending: loads context, sends via Resend, updates status.
   *
   * @precondition An email row must exist with status 'pending'.
   * @postcondition The email is sent via Resend and status updated to 'sent'.
   * @param emailId - The email id to send.
   */
  @DBOS.workflow()
  static async run(emailId: number): Promise<void> {
    const context = await SendOwnerEmail.loadContext(emailId);
    if (!context) return;

    const result = await SendOwnerEmail.sendViaResend(context);
    await SendOwnerEmail.markSent(emailId, result.messageId);

    if (context.emailCount > 2) {
      const { UpdateChatSummary } = await import('./update-chat-summary.js');
      await DBOS.startWorkflow(UpdateChatSummary).run(context.chatId);
    }
  }

  /**
   * Step: loads all context needed to send the email.
   *
   * @param emailId - The email id.
   * @returns The email context, or null if not found.
   */
  @DBOS.step()
  static async loadContext(emailId: number) {
    const emailRepo = container.resolve<EmailRepository>('EmailRepository');
    const chatRepo = container.resolve<ChatRepository>('ChatRepository');
    const companyRepo = container.resolve<CompanyRepository>('CompanyRepository');
    const endUserRepo = container.resolve<EndUserRepository>('EndUserRepository');

    const email = await emailRepo.findById(emailId);
    if (!email) return null;

    const chat = await chatRepo.findById(email.chatId);
    if (!chat) return null;

    const endUser = await endUserRepo.findById(chat.endUserId);
    if (!endUser?.email) return null;

    const allEmails = await emailRepo.findAllByChatId(chat.id, { limit: 100 });
    const latestInbound = [...allEmails].reverse().find((e) => e.direction === 'inbound');
    const latestEmail = allEmails.length > 0 ? allEmails[allEmails.length - 1] : null;

    let fromAddress = latestInbound?.replyTo;
    if (!fromAddress) {
      const company = await companyRepo.findById(chat.companyId);
      fromAddress = company?.emails?.[0] ?? 'noreply@mail.phonetastic.ai';
    }

    return {
      chatId: chat.id,
      from: fromAddress,
      to: endUser.email,
      replyTo: fromAddress,
      subject: chat.subject ?? 'Re: Your inquiry',
      text: email.bodyText ?? '',
      inReplyTo: latestEmail?.messageId ?? undefined,
      references: latestEmail?.referenceIds ?? undefined,
      emailCount: allEmails.length,
    };
  }

  /**
   * Step: sends the email via Resend.
   *
   * @param context - The email context.
   * @returns The Resend send result.
   */
  @DBOS.step({ retriesAllowed: true, maxAttempts: 3, intervalSeconds: 2, backoffRate: 2 })
  static async sendViaResend(context: {
    from: string;
    to: string;
    replyTo: string;
    subject: string;
    text: string;
    inReplyTo?: string;
    references?: string[];
  }) {
    const resendService = container.resolve<ResendService>('ResendService');
    return resendService.sendEmail({
      from: context.from,
      to: context.to,
      replyTo: context.replyTo,
      subject: context.subject,
      text: context.text,
      inReplyTo: context.inReplyTo,
      references: context.references,
    });
  }

  /**
   * Step: marks the email as sent and stores the message ID.
   *
   * @param emailId - The email id.
   * @param messageId - The RFC Message-ID from the send result.
   */
  @DBOS.step()
  static async markSent(emailId: number, messageId: string): Promise<void> {
    const emailRepo = container.resolve<EmailRepository>('EmailRepository');
    await emailRepo.markSent(emailId, messageId);
  }
}
