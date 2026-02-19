import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { referralLink, user } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { error, redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, cookies, locals }) => {
	const link = await db.query.referralLink.findFirst({
		where: and(
			eq(referralLink.code, params.code),
			eq(referralLink.isActive, true)
		)
	});

	if (!link) {
		throw error(404, 'Referral link not found or inactive');
	}

	// Store referral code in cookie for use after OAuth
	cookies.set('referral_code', params.code, {
		path: '/',
		maxAge: 60 * 60 * 24, // 24 hours
		httpOnly: true,
		secure: false,
		sameSite: 'lax'
	});

	// If already logged in, redirect to app (the callback will handle the referral)
	if (locals.user && locals.session) {
		throw redirect(302, '/app');
	}

	// Get ambassador name for display
	const ambassador = await db.query.user.findFirst({
		where: eq(user.id, link.ambassadorId),
		columns: { firstName: true, lastName: true }
	});

	return {
		pathway: link.pathway,
		ambassadorName: ambassador
			? `${ambassador.firstName || ''} ${ambassador.lastName || ''}`.trim() || 'An ambassador'
			: 'An ambassador',
		code: params.code
	};
};
