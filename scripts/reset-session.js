import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { User } from '../src/modules/users/user.model.js';
import { Business } from '../src/modules/businesses/business.model.js';
import { BusinessMember } from '../src/modules/business-members/business-member.model.js';
import { Transaction } from '../src/modules/transactions/transaction.model.js';
import { Supplier } from '../src/modules/suppliers/supplier.model.js';
import { PaymentRecord } from '../src/modules/payments/payment-record.model.js';
import { ConversationSession } from '../src/modules/conversations/session.model.js';
import { MessageLog } from '../src/modules/whatsapp/message-log.model.js';

async function resetAllOrUser() {
  const phoneArg = process.argv[2];

  await mongoose.connect(env.MONGODB_URI);
  console.log('Connected to MongoDB at:', env.MONGODB_URI);

  if (phoneArg && phoneArg !== '--all') {
    const cleanNumber = phoneArg.replace(/\D/g, '');
    console.log(`Resetting restaurant data for phone: ${cleanNumber}...`);
    const user = await User.findOne({ whatsappNumber: cleanNumber });
    if (user) {
      const businesses = await Business.find({ ownerId: user._id });
      const bIds = businesses.map((b) => b._id);
      await Transaction.deleteMany({ businessId: { $in: bIds } });
      await Supplier.deleteMany({ businessId: { $in: bIds } });
      await PaymentRecord.deleteMany({ businessId: { $in: bIds } });
      await BusinessMember.deleteMany({ userId: user._id });
      await Business.deleteMany({ ownerId: user._id });
      await User.deleteOne({ _id: user._id });
    }
    await ConversationSession.deleteMany({ whatsappNumber: cleanNumber });
    await MessageLog.deleteMany({ sender: cleanNumber });
    console.log(`✅ Successfully reset data for ${cleanNumber}. Restaurant owner can start fresh!`);
  } else {
    console.log('Resetting all restaurant money management data...');
    await Transaction.deleteMany({});
    await Supplier.deleteMany({});
    await PaymentRecord.deleteMany({});
    await BusinessMember.deleteMany({});
    await Business.deleteMany({});
    await ConversationSession.deleteMany({});
    await MessageLog.deleteMany({});
    await User.deleteMany({});
    console.log('✅ All restaurant financial records and sessions cleared.');
  }

  await mongoose.disconnect();
  process.exit(0);
}

resetAllOrUser().catch((err) => {
  console.error('Error during reset:', err);
  process.exit(1);
});
