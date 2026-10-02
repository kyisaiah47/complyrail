import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="not-found">
      <h1>There is nothing at this link.</h1>
      <p>An order link is the full link from your email. Check that no part of it was cut off.</p>
      <p>
        <Link href="/">Go to the start page</Link>
      </p>
    </main>
  );
}
