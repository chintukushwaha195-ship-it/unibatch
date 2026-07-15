import { NextResponse } from 'next/server';

// Session cookie ka naam — same jo lib/auth.js mein hai
const SESSION_COOKIE = 'unibatch_session';

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Sirf /admin route protect karo
  // /admin-login ko mat rokho — woh login page hai!
  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin-login')) {
    const sessionCookie = request.cookies.get(SESSION_COOKIE);

    // Cookie nahi mili → seedha login page pe bhejo
    if (!sessionCookie?.value) {
      const loginUrl = new URL('/admin-login', request.url);
      // Redirect ke baad wapas /admin pe jaane ke liye
      loginUrl.searchParams.set('from', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

// Middleware sirf inhi routes pe chalega
export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
