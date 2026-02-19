import { redirect } from '@sveltejs/kit';
import { hackClubAuth, lucia } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { user, programSeason, referralLink, referralSignup, userPathway } from '$lib/server/db/schema';
import { env } from '$env/dynamic/private';
import { generateIdFromEntropySize } from 'lucia';
import { EnrollmentService } from '$lib/server/services';
import { eq, and } from 'drizzle-orm';

export const GET = async ({ url, cookies, locals }) => {
  const code = url.searchParams.get('code');
  if (!code) {
    throw redirect(302, '/');
  }

  try {
    const { token } = await hackClubAuth.getToken({
      code,
      redirect_uri: `${env.BASE_URL}/api/auth/callback`
    });

    const accessToken = token.access_token as string;

    const response = await fetch('https://auth.hackclub.com/api/v1/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    const data = await response.json();
    const hackClubUser = data.identity;

    const userData = {
      email: hackClubUser.primary_email,
      firstName: hackClubUser.first_name || null,
      lastName: hackClubUser.last_name || null,
      slackId: hackClubUser.slack_id || null,
      verificationStatus: hackClubUser.verification_status || null,
      yswsEligible: hackClubUser.ysws_eligible || false
    };

    const existing = await db.query.user.findFirst({
      where: eq(user.hackClubId, hackClubUser.id)
    });

    let dbUser;
    if (existing) {
      const [updated] = await db.update(user)
        .set(userData)
        .where(eq(user.hackClubId, hackClubUser.id))
        .returning();
      dbUser = updated;
    } else {
      const [created] = await db.insert(user)
        .values({
          id: generateIdFromEntropySize(10),
          hackClubId: hackClubUser.id,
          ...userData
        })
        .returning();
      dbUser = created;
    }

    let sessionCookie;
    if (locals.session && locals.user?.id === dbUser.id) {
      sessionCookie = lucia.createSessionCookie(locals.session.id);
    } else {
      const session = await lucia.createSession(dbUser.id, {});
      sessionCookie = lucia.createSessionCookie(session.id);
    }

    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: '.',
      ...sessionCookie.attributes
    });

    const activeSeason = await db.query.programSeason.findFirst({
      where: eq(programSeason.isActive, true)
    });

    if (activeSeason) {
      await EnrollmentService.enrollParticipant(dbUser.id, activeSeason.slug);
    }

    // Handle referral code
    const referralCode = cookies.get('referral_code');
    if (referralCode) {
      const refLink = await db.query.referralLink.findFirst({
        where: and(
          eq(referralLink.code, referralCode),
          eq(referralLink.isActive, true)
        )
      });

      if (refLink) {
        // Auto-add the pathway
        await db.insert(userPathway)
          .values({
            userId: dbUser.id,
            pathway: refLink.pathway
          })
          .onConflictDoNothing();

        // Record the referral signup
        await db.insert(referralSignup)
          .values({
            referralLinkId: refLink.id,
            userId: dbUser.id
          })
          .onConflictDoNothing();
      }

      // Clear the referral cookie
      cookies.delete('referral_code', { path: '/' });
    }

    throw redirect(302, '/auth/complete');
  } catch (error) {
    if (error instanceof Response || (error as any)?.status === 302) {
      throw error;
    }
    console.error('Auth callback error:', error);
    throw redirect(302, '/?error=auth_failed');
  }
};
