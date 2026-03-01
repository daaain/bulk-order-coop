export interface JwtPayload {
	sub: string;
	email: string;
	iat: number;
	exp: number;
}

function base64UrlEncode(data: Uint8Array): string {
	let binary = '';
	for (const byte of data) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string) {
	const padded = str.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function textEncode(str: string) {
	return new TextEncoder().encode(str);
}

async function getKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		textEncode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
}

export async function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, expiresInSeconds = 86400 * 7): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const fullPayload: JwtPayload = {
		...payload,
		iat: now,
		exp: now + expiresInSeconds
	};

	const header = base64UrlEncode(textEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
	const body = base64UrlEncode(textEncode(JSON.stringify(fullPayload)));
	const signingInput = `${header}.${body}`;

	const key = await getKey(secret);
	const signature = await crypto.subtle.sign('HMAC', key, textEncode(signingInput));

	return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload> {
	const parts = token.split('.');
	if (parts.length !== 3) {
		throw new Error('Invalid token format');
	}

	const [header, body, sig] = parts;
	const signingInput = `${header}.${body}`;

	const key = await getKey(secret);
	const valid = await crypto.subtle.verify('HMAC', key, base64UrlDecode(sig), textEncode(signingInput));

	if (!valid) {
		throw new Error('Invalid token signature');
	}

	const payload: JwtPayload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));

	const now = Math.floor(Date.now() / 1000);
	if (payload.exp < now) {
		throw new Error('Token expired');
	}

	return payload;
}
