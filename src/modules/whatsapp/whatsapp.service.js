import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { normalizeWhatsappNumber } from '../../utils/phone.js';

class WhatsAppService {
  get baseUrl() {
    return env.WHATSAPP_API_BASE_URL;
  }
  get apiVersion() {
    return env.WHATSAPP_API_VERSION;
  }
  get phoneNumberId() {
    return env.WHATSAPP_PHONE_NUMBER_ID;
  }
  get accessToken() {
    return env.WHATSAPP_ACCESS_TOKEN;
  }

  /**
   * Determine if we are running in mock/offline mode (e.g. during dev/tests without live credentials)
   */
  isMockMode() {
    return (
      env.NODE_ENV === 'test' ||
      process.env.MOCK_WHATSAPP === 'true' ||
      !this.accessToken ||
      this.accessToken === 'test_access_token' ||
      !this.phoneNumberId ||
      this.phoneNumberId === 'test_phone_number_id'
    );
  }

  /**
   * Get the messages endpoint URL
   */
  getMessagesUrl() {
    return `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/messages`;
  }

  /**
   * Send an HTTP request to Meta Graph API, masking tokens from logs
   */
  async makeApiRequest(url, payload, operation = null) {
    const op = operation || (payload?.status === 'read' ? 'markAsRead' : payload?.type || 'unknown');

    if (this.isMockMode()) {
      logger.info(
        {
          operation: op,
          recipient: payload.to,
          type: payload.type,
          summary: payload.text?.body || payload.interactive?.action?.buttons?.map((b) => b.reply.title),
        },
        '[MOCK] Outbound WhatsApp message simulated',
      );

      return {
        messaging_product: 'whatsapp',
        contacts: [{ input: payload.to, wa_id: payload.to }],
        messages: [{ id: `wamid.mock_${Date.now()}` }],
      };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (!response.ok) {
        const metaError = data?.error || {};
        const logFn = op === 'markAsRead' ? logger.warn.bind(logger) : logger.error.bind(logger);
        logFn(
          {
            operation: op,
            apiVersion: this.apiVersion,
            status: response.status,
            error: metaError.message || 'Meta Cloud API request failed',
            code: metaError.code,
            errorSubcode: metaError.error_subcode,
            errorUserTitle: metaError.error_user_title,
            errorUserMsg: metaError.error_user_msg,
            errorDataDetails: metaError.error_data?.details,
            fbtraceId: metaError.fbtrace_id,
          },
          'Error calling WhatsApp Cloud API',
        );
        throw new Error(metaError.message || 'Failed to dispatch WhatsApp message');
      }

      return data;
    } catch (error) {
      // Ensure accessToken and message content are never leaked in logs
      logger.error(
        {
          operation: op,
          apiVersion: this.apiVersion,
          error: error.message,
          recipient: payload.to,
          type: payload.type,
        },
        'WhatsApp Cloud API dispatch error',
      );
      throw error;
    }
  }

  /**
   * Send a standard text message
   * @param {string} to - Recipient phone number (E.164 without '+')
   * @param {string} text - Message body text
   * @param {boolean} previewUrl - Whether to render URL previews
   */
  async sendTextMessage(to, text, previewUrl = false) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeWhatsappNumber(to),
      type: 'text',
      text: {
        preview_url: previewUrl,
        body: text,
      },
    };

    return this.makeApiRequest(this.getMessagesUrl(), payload, 'sendTextMessage');
  }

  /**
   * Send an interactive button message (up to 3 quick-reply buttons)
   * @param {string} to - Recipient phone number
   * @param {string} bodyText - Main body text
   * @param {Array<{id: string, title: string}>} buttons - Up to 3 buttons
   * @param {string} [headerText] - Optional header text
   * @param {string} [footerText] - Optional footer text
   */
  async sendButtonMessage(to, bodyText, buttons = [], headerText = null, footerText = null) {
    if (buttons.length === 0 || buttons.length > 3) {
      throw new Error('Meta WhatsApp interactive button messages accept between 1 and 3 buttons');
    }

    const interactiveButtons = buttons.map((btn) => ({
      type: 'reply',
      reply: {
        id: btn.id,
        title: btn.title.slice(0, 20), // WhatsApp title limit is 20 chars
      },
    }));

    const interactivePayload = {
      type: 'button',
      body: { text: bodyText },
      action: { buttons: interactiveButtons },
    };

    if (headerText) {
      interactivePayload.header = {
        type: 'text',
        text: headerText,
      };
    }

    if (footerText) {
      interactivePayload.footer = {
        text: footerText,
      };
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeWhatsappNumber(to),
      type: 'interactive',
      interactive: interactivePayload,
    };

    return this.makeApiRequest(this.getMessagesUrl(), payload, 'sendButtonMessage');
  }

  /**
   * Send an image message
   * @param {string} to - Recipient phone number
   * @param {string} imageUrl - Publicly accessible image URL
   * @param {string} [caption] - Optional image caption
   */
  async sendImageMessage(to, imageUrl, caption = null) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeWhatsappNumber(to),
      type: 'image',
      image: {
        link: imageUrl,
        ...(caption && { caption }),
      },
    };

    return this.makeApiRequest(this.getMessagesUrl(), payload, 'sendImageMessage');
  }

  /**
   * Send a pre-approved template message
   * @param {string} to - Recipient phone number
   * @param {string} templateName - Approved template name
   * @param {string} languageCode - Language code, e.g., 'en', 'ml'
   * @param {Array} [components] - Dynamic components (body parameters, buttons)
   */
  async sendTemplateMessage(to, templateName, languageCode = 'en', components = []) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeWhatsappNumber(to),
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components.length > 0 && { components }),
      },
    };

    return this.makeApiRequest(this.getMessagesUrl(), payload, 'sendTemplateMessage');
  }

  /**
   * Mark an incoming message as read
   * @param {string} messageId - Incoming message ID (e.g., wamid.HBg...)
   */
  async markMessageAsRead(messageId) {
    if (this.isMockMode()) {
      logger.debug({ messageId }, '[MOCK] Message marked as read');
      return { success: true };
    }

    const payload = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    };

    return this.makeApiRequest(this.getMessagesUrl(), payload, 'markAsRead');
  }

  async markAsRead(messageId) {
    return this.markMessageAsRead(messageId);
  }

  /**
   * Download media by mediaId (helper for Phase 5)
   * @param {string} mediaId - WhatsApp media identifier
   */
  async downloadMedia(mediaId) {
    if (this.isMockMode()) {
      return { buffer: Buffer.from('mock_image_binary'), mimeType: 'image/jpeg' };
    }

    const metaUrl = `${this.baseUrl}/${this.apiVersion}/${mediaId}`;
    const metaResponse = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      signal: AbortSignal.timeout(15000),
    });

    if (!metaResponse.ok) {
      throw new Error(`Failed to retrieve media URL for mediaId: ${mediaId}`);
    }

    const metaData = await metaResponse.json();
    const downloadUrl = metaData.url;

    const fileResponse = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      signal: AbortSignal.timeout(20000),
    });

    if (!fileResponse.ok) {
      throw new Error(`Failed to download media content from: ${downloadUrl}`);
    }

    const arrayBuffer = await fileResponse.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: metaData.mime_type || fileResponse.headers.get('content-type'),
    };
  }
}

export const whatsappService = new WhatsAppService();
