import { Resend } from 'resend';
import { Webhook } from 'svix';
import { randomUUID } from 'node:crypto';

/**
 * Describes a received email from Resend.
 */
export interface ReceivedEmail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  attachments: { id: string; filename: string; contentType: string }[];
}

/**
 * Describes the result of sending an email via Resend.
 */
export interface SendEmailResult {
  id: string;
  messageId: string;
}

/**
 * Abstraction over Resend's email API for sending, receiving, and webhook verification.
 */
export interface ResendService {
  /**
   * Verifies a Resend/Svix webhook signature.
   *
   * @param payload - The raw request body.
   * @param headers - The Svix signature headers.
   * @returns True if the signature is valid.
   */
  verifyWebhookSignature(payload: string, headers: { svixId: string; svixTimestamp: string; svixSignature: string }): boolean;

  /**
   * Retrieves the full content of a received email.
   *
   * @param emailId - The Resend email ID.
   * @returns The received email content.
   */
  getReceivedEmail(emailId: string): Promise<ReceivedEmail>;

  /**
   * Downloads attachment content from Resend via a signed URL.
   *
   * @param emailId - The Resend email ID.
   * @param attachmentId - The Resend attachment ID.
   * @returns The file content as a Buffer.
   */
  getAttachmentContent(emailId: string, attachmentId: string): Promise<Buffer>;

  /**
   * Sends an email via Resend.
   *
   * @param params - Email parameters.
   * @returns The send result with Resend ID and Message-ID.
   */
  sendEmail(params: {
    from: string;
    to: string;
    subject: string;
    text: string;
    inReplyTo?: string;
    references?: string[];
    attachments?: { filename: string; content: Buffer; contentType: string }[];
  }): Promise<SendEmailResult>;
}

/**
 * Production Resend service backed by the Resend SDK and Svix webhook verification.
 *
 * @precondition Valid Resend API key and webhook secret.
 * @postcondition Emails can be sent, received emails retrieved, and webhooks verified.
 */
export class ResendServiceImpl implements ResendService {
  private readonly client: Resend;
  private readonly webhook: Webhook;

  /**
   * @param apiKey - Resend API key.
   * @param webhookSecret - Svix webhook signing secret.
   */
  constructor(apiKey: string, webhookSecret: string) {
    this.client = new Resend(apiKey);
    this.webhook = new Webhook(webhookSecret);
  }

  /** {@inheritDoc ResendService.verifyWebhookSignature} */
  verifyWebhookSignature(payload: string, headers: { svixId: string; svixTimestamp: string; svixSignature: string }): boolean {
    try {
      this.webhook.verify(payload, {
        'svix-id': headers.svixId,
        'svix-timestamp': headers.svixTimestamp,
        'svix-signature': headers.svixSignature,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** {@inheritDoc ResendService.getReceivedEmail} */
  async getReceivedEmail(emailId: string): Promise<ReceivedEmail> {
    const { data, error } = await this.client.emails.receiving.get(emailId);
    if (error) throw new Error(`Resend getReceivedEmail failed: ${error.message}`);

    const headers = data!.headers ?? {};
    const references = headers['references']?.split(/\s+/).filter(Boolean);

    return {
      from: data!.from,
      to: data!.to,
      subject: data!.subject,
      text: data!.text ?? '',
      html: data!.html ?? '',
      messageId: data!.message_id,
      inReplyTo: headers['in-reply-to'] || undefined,
      references: references?.length ? references : undefined,
      attachments: data!.attachments.map((a) => ({
        id: a.id,
        filename: a.filename ?? 'attachment',
        contentType: a.content_type,
      })),
    };
  }

  /** {@inheritDoc ResendService.getAttachmentContent} */
  async getAttachmentContent(emailId: string, attachmentId: string): Promise<Buffer> {
    const { data, error } = await this.client.emails.receiving.attachments.get({ emailId, id: attachmentId });
    if (error) throw new Error(`Resend getAttachmentContent failed: ${error.message}`);

    const response = await fetch(data!.download_url);
    if (!response.ok) throw new Error(`Attachment download failed: ${response.statusText}`);
    return Buffer.from(await response.arrayBuffer());
  }

  /** {@inheritDoc ResendService.sendEmail} */
  async sendEmail(params: {
    from: string;
    to: string;
    subject: string;
    text: string;
    inReplyTo?: string;
    references?: string[];
    attachments?: { filename: string; content: Buffer; contentType: string }[];
  }): Promise<SendEmailResult> {
    const messageId = `<${randomUUID()}@mail.phonetastic.ai>`;
    const headers: Record<string, string> = { 'Message-ID': messageId };
    if (params.inReplyTo) headers['In-Reply-To'] = params.inReplyTo;
    if (params.references?.length) headers['References'] = params.references.join(' ');

    const { data, error } = await this.client.emails.send({
      from: params.from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      headers,
      attachments: params.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        content_type: a.contentType,
      })),
    });
    if (error) throw new Error(`Resend sendEmail failed: ${error.message}`);

    return { id: data!.id, messageId };
  }
}

/**
 * Stub implementation of ResendService for testing.
 */
export class StubResendService implements ResendService {
  receivedEmails: Map<string, ReceivedEmail> = new Map();
  attachmentContents: Map<string, Buffer> = new Map();
  sentEmails: { from: string; to: string; subject: string; text: string }[] = [];
  signatureValid = true;
  private sendCounter = 0;

  /**
   * Sets a canned received email for retrieval.
   *
   * @param emailId - The email ID key.
   * @param email - The received email data.
   */
  setReceivedEmail(emailId: string, email: ReceivedEmail): void {
    this.receivedEmails.set(emailId, email);
  }

  /**
   * Sets canned attachment content for retrieval.
   *
   * @param key - The key in format `emailId:attachmentId`.
   * @param content - The file content.
   */
  setAttachmentContent(key: string, content: Buffer): void {
    this.attachmentContents.set(key, content);
  }

  verifyWebhookSignature(): boolean {
    return this.signatureValid;
  }

  async getReceivedEmail(emailId: string): Promise<ReceivedEmail> {
    const email = this.receivedEmails.get(emailId);
    if (!email) throw new Error(`No canned email for ${emailId}`);
    return email;
  }

  async getAttachmentContent(emailId: string, attachmentId: string): Promise<Buffer> {
    const key = `${emailId}:${attachmentId}`;
    const content = this.attachmentContents.get(key);
    if (content) return content;
    return Buffer.from(`stub-attachment-${attachmentId}`);
  }

  async sendEmail(params: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<SendEmailResult> {
    this.sendCounter++;
    this.sentEmails.push(params);
    return { id: `resend-${this.sendCounter}`, messageId: `<msg-${this.sendCounter}@resend.dev>` };
  }
}
