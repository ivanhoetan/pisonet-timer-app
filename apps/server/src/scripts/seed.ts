import dotenv from 'dotenv';
import { connectDb } from '../db';
import { config } from '../config';
import { Admin } from '../models/Admin';
import { User } from '../models/User';
import { Computer } from '../models/Computer';
import { Transaction } from '../models/Transaction';
import { hashSecret } from '../utils/crypto';

dotenv.config();

async function seed(): Promise<void> {
  await connectDb();

  let admin = await Admin.findOne({ email: config.adminEmail });
  if (!admin) {
    admin = await Admin.create({
      email: config.adminEmail,
      passwordHash: await hashSecret(config.adminPassword),
      role: 'owner',
    });
    console.log(`Created admin: ${config.adminEmail} / ${config.adminPassword}`);
  } else {
    console.log(`Admin already exists: ${config.adminEmail}`);
  }

  let user = await User.findOne({ username: 'demo' });
  if (!user) {
    user = await User.create({
      username: 'demo',
      passwordHash: await hashSecret('demo1234'),
      pinHash: await hashSecret('1234'),
      balanceSeconds: 0,
      mobileNumber: '09171234567',
    });
    console.log('Created demo user: demo / demo1234 (PIN: 1234)');
  }

  let computer = await Computer.findOne({ computerCode: 'PC01' });
  if (!computer) {
    const authSecret = 'dev-secret-pc01-change-in-production';
    computer = await Computer.create({
      computerCode: 'PC01',
      name: 'PC 01',
      authSecret,
      status: 'OFFLINE',
    });
    console.log(`Created computer PC01 (id: ${computer._id}, authSecret: ${authSecret})`);
  } else {
    console.log(`Computer PC01 already exists (id: ${computer._id})`);
  }

  if (user.balanceSeconds < 3600) {
    user.balanceSeconds = 3600;
    await user.save();

    await Transaction.create({
      userId: user._id,
      minutesAdded: 60,
      paymentMethod: 'manual',
      paymentReference: 'seed-topup',
      createdBy: admin._id,
    });

    console.log('Topped up demo user with 60 minutes');
  }

  console.log('\n--- Seed complete ---');
  console.log(`Admin login: POST /auth/admin/login { "email": "${config.adminEmail}", "password": "${config.adminPassword}" }`);
  console.log(`Demo user PIN login: POST /auth/pin-login { "username": "demo", "pin": "1234", "computerId": "${computer._id}" }`);
  console.log(`Computer ID for pairing: ${computer._id}`);

  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
