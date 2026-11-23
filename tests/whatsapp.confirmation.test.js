import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { conversationService } from '../src/modules/conversations/conversation.service.js';
import { businessService } from '../src/modules/businesses/business.service.js';
import { ConversationSession } from '../src/modules/conversations/session.model.js';
import { Transaction } from '../src/modules/transactions/transaction.model.js';
import { Product } from '../src/modules/inventory/product.model.js';
import { whatsappService } from '../src/modules/whatsapp/whatsapp.service.js';

describe('WhatsApp Text Action Confirmation Flow', () => {
  const testPhone = '919876543211';
  const ownerName = 'Confirm Test Kitchen';

  beforeEach(() => {
    process.env.REQUIRE_WHATSAPP_CONFIRMATION = 'true';
  });

  afterEach(() => {
    delete process.env.REQUIRE_WHATSAPP_CONFIRMATION;
    vi.restoreAllMocks();
  });

  it('asks for confirmation before saving an expense and saves on confirm_text_action button', async () => {
    const buttonSpy = vi.spyOn(whatsappService, 'sendButtonMessage').mockResolvedValue({
      messaging_product: 'whatsapp',
      messages: [{ id: 'wamid.btn_1' }],
    });
    const textSpy = vi.spyOn(whatsappService, 'sendTextMessage').mockResolvedValue({
      messaging_product: 'whatsapp',
      messages: [{ id: 'wamid.txt_1' }],
    });

    await conversationService.handleIncomingMessage(
      testPhone,
      'Innu vegetables vangiyathu 850 rupa',
      null,
      ownerName,
    );

    const { business } = await businessService.resolveBusinessForUser(testPhone, ownerName);
    expect(await Transaction.countDocuments({ businessId: business._id })).toBe(0);

    expect(buttonSpy).toHaveBeenCalledTimes(1);
    const [recipient, bodyText, buttons] = buttonSpy.mock.calls[0];
    expect(recipient).toBe(testPhone);
    expect(bodyText).toContain('You typed: "Innu vegetables vangiyathu 850 rupa"');
    expect(bodyText).toContain('Expense');
    expect(buttons.map((b) => b.id)).toEqual(['confirm_text_action', 'cancel_text_action']);

    // Confirm via interactive button
    await conversationService.handleIncomingMessage(testPhone, 'Confirm', 'confirm_text_action', ownerName);

    const saved = await Transaction.findOne({ businessId: business._id, type: 'EXPENSE' });
    expect(saved).toBeTruthy();
    expect(saved.amount).toBe(850);
    expect(textSpy).toHaveBeenCalled();

    const session = await ConversationSession.findOne({ whatsappNumber: testPhone });
    expect(session.pendingConfirmation).toBeNull();
  });

  it('asks for confirmation before adding inventory and saves on text "Confirm"', async () => {
    vi.spyOn(whatsappService, 'sendButtonMessage').mockResolvedValue({
      messaging_product: 'whatsapp',
      messages: [{ id: 'wamid.btn_2' }],
    });
    vi.spyOn(whatsappService, 'sendTextMessage').mockResolvedValue({
      messaging_product: 'whatsapp',
      messages: [{ id: 'wamid.txt_2' }],
    });

    await conversationService.handleIncomingMessage(
      testPhone,
      'Add product Chicken 50 kg',
      null,
      ownerName,
    );

    const { business } = await businessService.resolveBusinessForUser(testPhone, ownerName);
    expect(await Product.countDocuments({ businessId: business._id })).toBe(0);

    await conversationService.handleIncomingMessage(testPhone, 'Confirm', null, ownerName);

    const product = await Product.findOne({ businessId: business._id, name: 'Chicken' });
    expect(product).toBeTruthy();
    expect(product.currentStock).toBe(50);
  });

  it('cancels without saving when cancel_text_action is clicked', async () => {
    vi.spyOn(whatsappService, 'sendButtonMessage').mockResolvedValue({
      messaging_product: 'whatsapp',
      messages: [{ id: 'wamid.btn_3' }],
    });
    const textSpy = vi.spyOn(whatsappService, 'sendTextMessage').mockResolvedValue({
      messaging_product: 'whatsapp',
      messages: [{ id: 'wamid.txt_3' }],
    });

    await conversationService.handleIncomingMessage(
      testPhone,
      "Today's sales 5000",
      null,
      ownerName,
    );

    await conversationService.handleIncomingMessage(testPhone, 'Cancel', 'cancel_text_action', ownerName);

    const { business } = await businessService.resolveBusinessForUser(testPhone, ownerName);
    expect(await Transaction.countDocuments({ businessId: business._id })).toBe(0);
    expect(textSpy).toHaveBeenCalledWith(testPhone, expect.stringContaining('cancelled'));

    const session = await ConversationSession.findOne({ whatsappNumber: testPhone });
    expect(session.pendingConfirmation).toBeNull();
  });

  it('does not ask for confirmation on read-only queries', async () => {
    const buttonSpy = vi.spyOn(whatsappService, 'sendButtonMessage').mockResolvedValue({});
    const textSpy = vi.spyOn(whatsappService, 'sendTextMessage').mockResolvedValue({});

    await conversationService.handleIncomingMessage(testPhone, 'Help', null, ownerName);

    expect(buttonSpy).not.toHaveBeenCalled();
    expect(textSpy).toHaveBeenCalledTimes(1);
  });
});
