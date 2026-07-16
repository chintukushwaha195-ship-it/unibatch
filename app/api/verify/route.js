import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { normalizeTxHash } from '@/lib/blockchain';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email');
  const txHash = searchParams.get('tx');

  if (!email || !txHash) {
    return new NextResponse('Missing email or transaction hash', { status: 400 });
  }

  try {
    const db = await getDb();
    const normalizedHash = normalizeTxHash(txHash);

    const contributor = await db.collection('contributors').findOne({
      email: email.toLowerCase(),
      txHash: normalizedHash
    });

    if (!contributor) {
      return new NextResponse('❌ Invalid verification link. Please check your email.', { 
        status: 404 
      });
    }

    if (contributor.emailVerified) {
      return new NextResponse('✅ This contribution has already been verified!', { 
        status: 200 
      });
    }

    await db.collection('contributors').updateOne(
      { _id: contributor._id },
      { 
        $set: { 
          emailVerified: true, 
          verifiedAt: new Date() 
        } 
      }
    );

    return new NextResponse(`
      <!DOCTYPE html>
      <html>
        <head><title>Verified - UNIBATCH</title></head>
        <body style="font-family: Arial; background: #0f0f1a; color: #e0e0e0; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="text-align: center; background: #1a1a2e; padding: 40px; border-radius: 16px; max-width: 500px;">
            <h1 style="color: #4ade80;">✅ Email Verified!</h1>
            <p>Your contribution (ID: #${String(contributor.displayId).padStart(6, '0')}) has been verified.</p>
            <p style="font-size: 14px; color: #9ca3af;">The admin will review and approve your contribution shortly.</p>
            <a href="/" style="display: inline-block; margin-top: 20px; padding: 10px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px;">← Back to Home</a>
          </div>
        </body>
      </html>
    `, {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });

  } catch (error) {
    console.error('Verification error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
