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
 * Stub implementation of ResendService for testing.
 */
export class StubResendService implements ResendService {
  receivedEmails: Map<string, ReceivedEmail> = new Map();
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

  verifyWebhookSignature(): boolean {
    return this.signatureValid;
  }

  async getReceivedEmail(emailId: string): Promise<ReceivedEmail> {
    const email = this.receivedEmails.get(emailId);
    if (!email) throw new Error(`No canned email for ${emailId}`);
    return email;
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
