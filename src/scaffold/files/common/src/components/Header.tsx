import Link from 'next/link';
import type { PackInfo } from '@/lib/pack-types';

/* The site header. Console is one compact bar. Simple has more room and plain links. */
export default function Header({ info, variant }: { info: PackInfo; variant: 'console' | 'simple' }) {
  return (
    <header className={`site-head site-head-${variant}`}>
      <Link className="brand" href="/" aria-label={`${info.name} home`}>
        <span className="brand-mark" aria-hidden="true" />
        {info.name}
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/#start">Start an order</Link>
        <Link href="/#how">How it works</Link>
      </nav>
    </header>
  );
}
