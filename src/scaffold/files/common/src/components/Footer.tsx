import type { ReactNode } from 'react';
import type { PackInfo } from '@/lib/pack-types';

/* The footer of every route. `children` holds the view controls when the app has both views. */
export default function Footer({ info, children }: { info: PackInfo; children?: ReactNode }) {
  return (
    <footer className="site-foot">
      <p>
        {info.name}. Orders run on <a href="https://github.com/kyisaiah47/complyrail">ComplyRail</a>.
      </p>
      {children}
    </footer>
  );
}
