export async function sendMagicLink(
	apiKey: string,
	email: string,
	token: string,
	baseUrl: string
): Promise<void> {
	const verifyUrl = `${baseUrl}/auth/verify?token=${token}`;

	console.log(`[email] apiKey type=${typeof apiKey}, length=${apiKey?.length ?? 'N/A'}, prefix=${apiKey?.substring(0, 5) ?? 'N/A'}`);

	if (!apiKey || apiKey === 're_xxx') {
		console.log(`[email] DEV MODE — skipping Resend, magic link for ${email}: ${verifyUrl}`);
		return;
	}

	console.log(`[email] Sending to ${email} via Resend...`);

	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify({
			from: 'Bulk Order Co-op <noreply@bulkordercoop.org>',
			to: [email],
			subject: 'Your sign-in link',
			html: `
				<h2>Sign in to Bulk Order Co-op</h2>
				<p>Click the link below to sign in. This link expires in 15 minutes.</p>
				<p><a href="${verifyUrl}">Sign in to Bulk Order Co-op</a></p>
				<p><small>If you didn't request this, you can safely ignore this email.</small></p>
			`
		})
	});

	const body = await res.text();
	console.log(`[email] Resend response: status=${res.status}, body=${body}`);

	if (!res.ok) {
		throw new Error(`Failed to send email: ${res.status} ${body}`);
	}
}
