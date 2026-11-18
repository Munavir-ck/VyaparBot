#!/usr/bin/env node

/**
 * Local WhatsApp Conversation Simulator for Restaurant Money Management
 * Usage:
 *   node scripts/simulate-whatsapp.js
 */

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const WEBHOOK_URL = `${SERVER_URL}/webhook/whatsapp`;

const sendMockWebhook = async ({ phone = '919876543210', name = 'Malabar Hotel', text = '', buttonId = null }) => {
  const messageObj = {
    from: phone,
    id: `wamid.sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };

  if (buttonId) {
    messageObj.type = 'interactive';
    messageObj.interactive = {
      type: 'button_reply',
      button_reply: { id: buttonId, title: text || buttonId },
    };
  } else {
    messageObj.type = 'text';
    messageObj.text = { body: text || '' };
  }

  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123456789',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ profile: { name }, wa_id: phone }],
              messages: [messageObj],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };

  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return response.json();
};

const runFullSimulation = async () => {
  const phone = '919876543210';
  const name = 'Chef Kunjali';

  console.log('🚀 Starting Restaurant Money Management WhatsApp Simulation...\n');

  const steps = [
    { desc: '1. Greeting', text: 'Hi' },
    {
      desc: "2. Record Daily Sales with breakdown (English)",
      text: "Today's sales 12500. Cash 7500 and UPI 5000.",
    },
    {
      desc: '3. Record Vegetable Expense (Manglish)',
      text: 'Innu vegetables vangiyathu 850 rupa',
    },
    {
      desc: '4. Record Meat Expense (Malayalam script)',
      text: 'ഇന്ന് 1400 രൂപ ഇറച്ചി വാങ്ങി, cash കൊടുത്തു',
    },
    {
      desc: '5. Record Gas Expense (English)',
      text: 'Paid 1200 for gas cylinder',
    },
    {
      desc: '6. Credit Purchase from Supplier',
      text: 'Bought meat from Majeed on credit 4500',
    },
    {
      desc: '7. Supplier Payment Settlement',
      text: 'Paid 2000 to supplier Majeed via UPI',
    },
    {
      desc: '8. Check Supplier Balance',
      text: 'Majeed balance ethra?',
    },
    {
      desc: '9. Request Daily Report (Malayalam)',
      text: 'ഇന്നത്തെ കണക്ക്',
    },
    {
      desc: '10. Request Monthly Report',
      text: 'Monthly report',
    },
  ];

  for (const step of steps) {
    console.log(`➡️  [${step.desc}] Sending: "${step.text}"`);
    try {
      const res = await sendMockWebhook({
        phone,
        name,
        text: step.text,
        buttonId: step.buttonId,
      });
      console.log(`   Response status:`, res.status || 'OK');
    } catch (err) {
      console.error(`   Error sending to server:`, err.message);
      console.log('   (Make sure the server is running: npm start)');
      break;
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log('\n✅ Simulation finished!');
};

runFullSimulation();
