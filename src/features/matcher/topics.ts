export const STRONG = 5;
export const MEDIUM = 3;
export const WEAK = 2;

export interface Cue {
  readonly pattern: RegExp;
  readonly weight: number;
  readonly reason: string;
}

export interface ContractCue {
  readonly post: RegExp;
  readonly label: RegExp;
}

export type NameMode = "needs-context" | "standalone";
export type NumberMode = "amounts" | "percents";
export type Fallback = "favourite" | "even-odds";

export interface Topic {
  readonly tickers: RegExp;
  readonly cues: readonly Cue[];
  readonly contractCues?: readonly ContractCue[];
  readonly names?: NameMode;
  readonly numbers?: NumberMode;
  readonly fallback: Fallback;
  readonly nearestExpiry?: true;
}

const cue = (pattern: RegExp, weight: number, reason: string): Cue => ({ pattern, weight, reason });

const FED_RATE = "Rate talk puts the Fed's December decision in play: {label}.";
const SPX_GENERIC: readonly Cue[] = [
  cue(/s&p|\bspx\b|wall street|stock market|dow jones|equities/iu, STRONG, "{hit} moves feed into the S&P 500's 2026 path."),
  cue(/\bstocks?\b|\bshares\b|\bindex(es)?\b/iu, MEDIUM, "Stock market moves feed into the S&P 500's 2026 path."),
  cue(/\brall(y|ies|ied)\b|sell-?off|surge[sd]?\b/iu, WEAK, "Stock market moves feed into the S&P 500's 2026 path."),
];

const nominee = (party: RegExp, partyReason: string): readonly Cue[] => [
  cue(party, WEAK, partyReason),
  cue(/nominee|nomination|primar(y|ies)|presidential/iu, MEDIUM, partyReason),
  cue(/\b2028\b/u, MEDIUM, partyReason),
];

const vice = (party: RegExp): readonly Cue[] => [
  cue(/vice[- ]president|\bvp\b|running mate|\bticket\b/iu, MEDIUM, "Running-mate buzz moves the 2028 VP nominee odds."),
  cue(party, WEAK, "Running-mate buzz moves the 2028 VP nominee odds."),
  cue(/\b2028\b/u, MEDIUM, "Running-mate buzz moves the 2028 VP nominee odds."),
];

const asset = (tickers: RegExp, cues: readonly Cue[], fallback: Fallback = "even-odds"): Topic => ({
  tickers,
  cues,
  numbers: "amounts",
  fallback,
  nearestExpiry: true,
});

const CRYPTO_MOVE = cue(/\bprices?\b|\$\d|sells?\b|selling|dump(s|ed|ing)?\b|rall(y|ies)|surge[sd]?\b|plunge[sd]?|crash(es|ed)?|\babove\b|\bbelow\b/iu, WEAK, "{hit} price action feeds the daily crypto price market.");

export const TOPICS: readonly Topic[] = [
  {
    tickers: /^FED\d/u,
    cues: [
      cue(/powell|warsh|fed chair/iu, STRONG, "Fed commentary from {hit} moves the December rate decision odds."),
      cue(/\bfed\b|fomc|federal reserve/iu, STRONG, FED_RATE),
      cue(/rate (hike|cut)s?|(hike|cut|raise|lower|hold)s? (interest )?rates?|basis points?|\bbps\b|interest rates?|monetary policy/iu, STRONG, FED_RATE),
      cue(/inflation|\bcpi\b|\bppi\b|\bpce\b/iu, WEAK, "Inflation data shapes the Fed's December decision: {label}."),
    ],
    contractCues: [
      { post: /hike|raise[sd]?\b|raising|hawkish|tighten/iu, label: /^(?!.*>).*hike/iu },
      { post: /\bcuts?\b|cutting|lower(s|ed)?\b|easing|dovish|slash/iu, label: /^(?!.*>).*cut/iu },
      { post: /\bhold(s|ing)?\b|pause[sd]?|steady|unchanged|maintain|on hold/iu, label: /maintain/iu },
    ],
    fallback: "favourite",
  },
  {
    tickers: /^NASDAQ/u,
    cues: [
      cue(/nasdaq|\bqqq\b/iu, STRONG, "{hit} moves feed into the Nasdaq-100's 2026 close."),
      cue(/tech stocks|big tech|magnificent seven|nvidia|semiconductor/iu, STRONG, "Tech stock moves feed into the Nasdaq-100's 2026 close."),
    ],
    numbers: "amounts",
    fallback: "even-odds",
  },
  { tickers: /^SPXEND/u, cues: SPX_GENERIC, numbers: "amounts", fallback: "even-odds" },
  {
    tickers: /^SPXHIGH/u,
    cues: [
      ...SPX_GENERIC,
      cue(/record high|all-time high|new high|rall(y|ies|ied)\b|surge[sd]?\b/iu, MEDIUM, "A stock rally raises the odds the S&P 500 reaches new highs."),
    ],
    numbers: "amounts",
    fallback: "even-odds",
  },
  {
    tickers: /^SPXLOW/u,
    cues: [
      ...SPX_GENERIC,
      cue(/sell-?off|plunge[sd]?|crash(es|ed)?|correction|bear market|tumble[sd]?/iu, MEDIUM, "A stock sell-off raises the odds the S&P 500 falls to new lows."),
    ],
    numbers: "amounts",
    fallback: "even-odds",
  },
  {
    tickers: /^HORMUZ/u,
    cues: [
      cue(/hormuz/iu, STRONG, "{hit} news drives when traffic through the Strait returns to normal."),
      cue(/\biran(ian)?\b|tankers?|shipping lanes?|persian gulf|blockade/iu, MEDIUM, "Gulf shipping news drives when Hormuz traffic returns to normal."),
    ],
    fallback: "even-odds",
  },
  {
    tickers: /^UNEMP/u,
    cues: [
      cue(/unemployment|jobless|jobs report|non-?farm|payrolls?/iu, STRONG, "Jobs data feeds directly into the 2026 unemployment market."),
      cue(/layoffs?|job (losses|cuts)|labor market|hiring/iu, MEDIUM, "Labor market news feeds into the 2026 unemployment market."),
    ],
    numbers: "percents",
    fallback: "even-odds",
  },
  {
    tickers: /^RECESSION/u,
    cues: [
      cue(/recession|stagflation|economy (shrinks?|shrank|contracts?|contracted)|negative growth/iu, STRONG, "Recession signals move the odds the US is in a recession this year."),
      cue(/downturn|slowdown|layoffs?/iu, MEDIUM, "Slowdown signals move the odds of a 2026 recession."),
    ],
    fallback: "favourite",
  },
  {
    tickers: /^GDP/u,
    cues: [
      cue(/\bgdp\b|gross domestic product/iu, STRONG, "GDP data feeds directly into the 2026 US growth market."),
      cue(/economic growth|economy (grew|grows|shrinks?|shrank|expands?|expanded|contracts?)/iu, MEDIUM, "Growth data feeds into the 2026 US GDP market."),
    ],
    numbers: "percents",
    fallback: "even-odds",
  },
  asset(/^WTI\d/u, [
    cue(/\bwti\b|crude|west texas/iu, STRONG, "{hit} moves feed directly into the daily WTI price market."),
    cue(/\boil\b|opec|barrels?|petroleum/iu, MEDIUM, "Oil headlines feed into the daily WTI price market."),
  ]),
  asset(/^BRENT\d/u, [
    cue(/brent/iu, STRONG, "{hit} moves feed directly into the daily Brent price market."),
    cue(/crude|\boil\b|opec|barrels?/iu, MEDIUM, "Oil headlines feed into the daily Brent price market."),
  ]),
  asset(/^XAU\d/u, [
    cue(/\bgold\b|\bxau\b|bullion/iu, STRONG, "{hit} moves feed directly into the daily gold price market."),
    cue(/precious metals?|safe[- ]haven/iu, MEDIUM, "Safe-haven flows feed into the daily gold price market."),
  ]),
  asset(/^XAG\d/u, [
    cue(/\bsilver\b|\bxag\b/iu, STRONG, "{hit} moves feed directly into the daily silver price market."),
    cue(/precious metals?/iu, MEDIUM, "Precious metals flows feed into the daily silver price market."),
  ]),
  asset(/^COPPER\d/u, [cue(/copper/iu, STRONG, "{hit} moves feed directly into the daily copper price market.")]),
  asset(/^NGAS\d/u, [cue(/natural gas|nat gas|\blng\b|henry hub/iu, STRONG, "{hit} moves feed directly into the daily natural gas price market.")]),
  asset(/^BTC\d/u, [
    cue(/bitcoin|\bbtc\b/iu, STRONG, "{hit} headlines move the daily Bitcoin price market."),
    cue(/crypto(currency|currencies)?\b/iu, MEDIUM, "Crypto market moves feed the daily Bitcoin price market."),
    CRYPTO_MOVE,
  ]),
  asset(/^ETH\d/u, [cue(/ethereum|\bether\b|\beth\b|vitalik/iu, STRONG, "{hit} headlines move the daily Ethereum price market."), CRYPTO_MOVE]),
  asset(/^SOL\d/u, [cue(/solana|\bsol\b/iu, STRONG, "{hit} headlines move the daily Solana price market."), CRYPTO_MOVE]),
  asset(/^XRP\d/u, [cue(/\bxrp\b|ripple/iu, STRONG, "{hit} headlines move the daily XRP price market."), CRYPTO_MOVE]),
  asset(/^HYPE\d/u, [cue(/hyperliquid|\$hype\b/iu, STRONG, "{hit} headlines move the daily HYPE price market."), CRYPTO_MOVE]),
  asset(/^ZEC\d/u, [cue(/zcash|\bzec\b/iu, STRONG, "{hit} headlines move the daily Zcash price market."), CRYPTO_MOVE]),
  {
    tickers: /^CRYPTOSTRUCT/u,
    cues: [
      cue(/clarity act|market structure|stablecoin bill|genius act|crypto (bill|legislation|law|regulation)|digital asset (bill|legislation)/iu, STRONG, "A stalled or advancing {hit} directly moves odds crypto structure law passes."),
      cue(/\bsenate\b|\bsec\b|congress|lawmakers/iu, WEAK, "Washington crypto rulemaking moves odds a market structure law passes."),
      cue(/crypto/iu, WEAK, "Washington crypto rulemaking moves odds a market structure law passes."),
    ],
    fallback: "favourite",
  },
  { tickers: /^SAVEACT/u, cues: [cue(/\bsave act\b/iu, STRONG, "Votes and rulings on the {hit} move the odds it becomes law.")], fallback: "favourite" },
  {
    tickers: /^BUYGREEN/u,
    cues: [
      cue(/greenland/iu, STRONG, "{hit} news moves the odds the US buys part of the island."),
      cue(/arctic|denmark|nuuk/iu, MEDIUM, "Arctic diplomacy moves the odds the US buys part of Greenland."),
    ],
    fallback: "even-odds",
  },
  {
    tickers: /^ALITORETIRE/u,
    cues: [
      cue(/alito|(supreme court|scotus).{0,40}(retire|vacan|step(s|ping)? down)|(retire|vacan).{0,40}(supreme court|scotus)/iu, STRONG, "Retirement talk moves the odds Justice Alito leaves the Supreme Court."),
    ],
    fallback: "even-odds",
  },
  {
    tickers: /^NASAMOON/u,
    cues: [
      cue(/artemis|\bnasa\b|moon landing|lunar/iu, STRONG, "{hit} news moves the odds of a NASA moon landing."),
      cue(/\bmoon\b|\borion\b|\bsls\b/iu, MEDIUM, "Moon mission news moves the odds of a NASA landing."),
    ],
    fallback: "even-odds",
  },
  {
    tickers: /^ZECEXPLOIT/u,
    cues: [
      cue(/orchard|vulnerabilit|exploit/iu, STRONG, "Security findings move the odds Zcash's Orchard pool is proven safe."),
      cue(/zcash|\bzec\b/iu, MEDIUM, "Zcash security news moves the odds Orchard is proven not exploited."),
    ],
    fallback: "favourite",
  },
  {
    tickers: /^BESTAI/u,
    cues: [
      cue(/best ai|ai leaderboard|ai models?|intelligence index|frontier models?|\bllms?\b|lmarena|chatbot arena|artificial analysis/iu, STRONG, "Model rankings move the odds on which AI is best at year-end."),
      cue(/anthropic|openai|deepmind|\bxai\b|meta ai|alibaba|baidu/iu, MEDIUM, "Lab news moves the odds on which AI is best at year-end."),
      cue(/claude|gemini|\bgpt-?\d|chatgpt|grok|llama|qwen|deepseek|ernie|fable|opus/iu, MEDIUM, "{hit} news moves the odds on which AI is best at year-end."),
      cue(/benchmark|top spot|takes the crown|leaderboard|\bsota\b|new model/iu, MEDIUM, "Leaderboard news moves the odds that {label} is the best AI at year-end."),
    ],
    contractCues: [
      { post: /anthropic|claude|fable|opus|sonnet|haiku/iu, label: /claude/iu },
      { post: /google|gemini|deepmind|carbon/iu, label: /gemini/iu },
      { post: /openai|chatgpt|\bgpt-?\d|astra|sora/iu, label: /gpt/iu },
      { post: /\bxai\b|grok/iu, label: /grok/iu },
      { post: /\bmeta\b|llama/iu, label: /llama/iu },
      { post: /qwen|alibaba/iu, label: /qwen/iu },
      { post: /baidu|ernie/iu, label: /ernie/iu },
    ],
    fallback: "favourite",
  },
  {
    tickers: /^DUNEPART3/u,
    cues: [
      cue(/\bdune\b/iu, STRONG, "{hit} reception news moves the Part Three Rotten Tomatoes score market."),
      cue(/rotten tomatoes|box office|critics|villeneuve/iu, MEDIUM, "Critic reaction moves the Dune: Part Three Rotten Tomatoes market."),
    ],
    numbers: "percents",
    fallback: "even-odds",
  },
  {
    tickers: /^AVENGERSDOOMSDAY/u,
    cues: [
      cue(/avengers|doomsday/iu, STRONG, "{hit} reception news moves the Rotten Tomatoes score market."),
      cue(/rotten tomatoes|box office|critics|marvel|\bmcu\b/iu, MEDIUM, "Critic reaction moves the Avengers: Doomsday Rotten Tomatoes market."),
    ],
    numbers: "percents",
    fallback: "even-odds",
  },
  {
    tickers: /^GOTY/u,
    cues: [
      cue(/game awards|\bgoty\b|game of the year|keighley/iu, STRONG, "Game Awards buzz moves the 2026 Game of the Year odds."),
      cue(/\bgta\s?(vi|6)\b|rockstar|grand theft auto/iu, STRONG, "{hit} news moves the 2026 Game of the Year odds."),
    ],
    contractCues: [{ post: /\bgta\s?(vi|6)\b|rockstar/iu, label: /grand theft auto/iu }],
    names: "standalone",
    fallback: "favourite",
  },
  {
    tickers: /^PRES2028/u,
    cues: [
      cue(/\b2028\b/u, MEDIUM, "2028 race news moves the presidential election odds."),
      cue(/presidential (run|bid|race|campaign|hopeful|candidate)|run for president|white house (run|bid)/iu, MEDIUM, "2028 race news moves the presidential election odds."),
    ],
    names: "needs-context",
    fallback: "favourite",
  },
  { tickers: /^DEMNOM/u, cues: nominee(/democrat(ic|s)?|\bdems\b/iu, "Primary news moves the 2028 Democratic nominee odds."), names: "needs-context", fallback: "favourite" },
  { tickers: /^REPNOM/u, cues: nominee(/republican|\bgop\b/iu, "Primary news moves the 2028 Republican nominee odds."), names: "needs-context", fallback: "favourite" },
  { tickers: /^GOPVP/u, cues: vice(/republican|\bgop\b/iu), names: "needs-context", fallback: "favourite" },
  { tickers: /^DEMVP/u, cues: vice(/democrat(ic|s)?|\bdems\b/iu), names: "needs-context", fallback: "favourite" },
  {
    tickers: /^CABINET/u,
    cues: [
      cue(/cabinet|administration|secretary/iu, MEDIUM, "Departure news moves the odds this official leaves the Trump administration."),
      cue(/resign(s|ed|ation)?|fired|ousted|steps? down|quits?|departure|leaves/iu, MEDIUM, "Departure news moves the odds this official leaves the Trump administration."),
    ],
    names: "needs-context",
    fallback: "favourite",
  },
  {
    tickers: /^LEAVE/u,
    cues: [
      cue(/resign(s|ed|ation)?|steps? down|ousted|leaves? office|no[- ]confidence|prime minister|president/iu, MEDIUM, "Leadership turmoil moves the odds this leader leaves office in 2026."),
    ],
    names: "needs-context",
    fallback: "favourite",
  },
  {
    tickers: /^DIAZCANEL/u,
    cues: [
      cue(/d[ií]az-?canel/iu, STRONG, "{hit} news moves the odds he leaves office."),
      cue(/\bcuba(n)?\b/iu, MEDIUM, "Cuban leadership news moves the odds Díaz-Canel leaves office."),
    ],
    fallback: "even-odds",
  },
  {
    tickers: /^FEDCRIME/u,
    cues: [cue(/charged|indict(ed|ment)|arrest(ed)?|prosecut|grand jury|\bdoj\b|justice department/iu, MEDIUM, "Prosecution news moves the odds this person is charged with a federal crime.")],
    names: "needs-context",
    fallback: "favourite",
  },
  {
    tickers: /^ILPM/u,
    cues: [cue(/israel(i)?|knesset|prime minister/iu, MEDIUM, "Israeli election news moves the odds on the next prime minister.")],
    names: "needs-context",
    fallback: "favourite",
  },
  {
    tickers: /^FRA\d/u,
    cues: [cue(/france|french|[ée]lys[ée]e|presidential/iu, MEDIUM, "French election news moves the odds on the 2027 presidential winner.")],
    names: "needs-context",
    fallback: "favourite",
  },
  {
    tickers: /^UKGEN/u,
    cues: [cue(/\buk\b|britain|british|general election|westminster|starmer|farage|downing street/iu, MEDIUM, "UK polling and election news move the odds on the next general election winner.")],
    names: "needs-context",
    fallback: "favourite",
  },
  {
    tickers: /^(HOUSE|SEN)\d/u,
    cues: [cue(/house (race|seat|election|district)|senate (race|seat|election)|midterms?|congressional|special election|\brep\b/iu, MEDIUM, "Race news moves the odds in this 2026 congressional contest.")],
    names: "needs-context",
    fallback: "favourite",
  },
];
