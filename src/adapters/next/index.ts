import type { QueryIR, SearchRecipe } from '../../search/types.js';
import type { IntelligenceAdapter } from '../types.js';

/**
 * Next.js IntelligenceAdapter v2.
 *
 * Capabilities:
 * - detect: route/page/API queries routed to Next.js patterns
 * - graph.denylist: Next.js framework functions not useful as impl roots
 * - graph.rootHints: page/route handler patterns that ARE real roots
 */
export const nextAdapter: IntelligenceAdapter = {
  id: 'next',

  detect(ir: QueryIR): SearchRecipe[] {
    if (!ir.traits.routeLike && !ir.traits.reactLike) return [];

    const recipes: SearchRecipe[] = [];
    const nlTokens = ir.nlTokens;

    const isApiRoute = nlTokens.some(t => ['api', 'endpoint', 'handler'].includes(t)) ||
      ir.phrases.some(p => p.includes('api route') || p.includes('api handler'));

    const isPageRoute = nlTokens.some(t => ['page', 'route', 'layout'].includes(t)) ||
      ir.phrases.some(p => p.includes('page component') || p.includes('app router'));

    if (isApiRoute) {
      recipes.push({
        id: 'next.api-route',
        adapter: 'next',
        retrievers: ['route', 'identifier'],
        exactIdentifiers: [],
        regexes: [
          { id: 'next-api-handler', pattern: 'export\\s+(?:default\\s+)?(?:async\\s+)?function\\s+handler', flags: 'g' },
          { id: 'next-route-handler', pattern: 'export\\s+(?:async\\s+)?function\\s+(?:GET|POST|PUT|DELETE|PATCH)', flags: 'g' },
        ],
        scoreBoost: 3,
        reasons: ['Next adapter: API route handler pattern'],
      });
    }

    if (isPageRoute) {
      recipes.push({
        id: 'next.page-component',
        adapter: 'next',
        retrievers: ['identifier', 'route'],
        exactIdentifiers: [],
        regexes: [
          { id: 'next-page-export', pattern: 'export\\s+default\\s+(?:function|const|class)', flags: 'g' },
          { id: 'next-get-static', pattern: 'getStaticProps|getServerSideProps|generateStaticParams', flags: 'g' },
        ],
        scoreBoost: 2,
        reasons: ['Next adapter: page component pattern'],
      });
    }

    return recipes;
  },

  graph: {
    denylist: [
      // Next.js data fetching helpers — not implementation roots
      'getStaticProps', 'getServerSideProps', 'getStaticPaths', 'generateStaticParams',
      'generateMetadata', 'revalidate',
      // Next.js router
      'useRouter', 'usePathname', 'useSearchParams', 'useParams',
      'redirect', 'notFound', 'permanentRedirect',
      // Next.js image/link
      'Image', 'Link', 'Script', 'Head',
    ],

    rootHints: [
      // Functions that ARE real implementation roots in Next.js
      // (future: boost these during graph expansion)
    ],
  },
};
