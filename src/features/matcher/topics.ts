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

const FED_RATE = "Rate-path talk is why traders price \"{label}\" at {pct} for the December Fed decision.";
const SPX_GENERIC: readonly Cue[] = [
  cue(/s&p|\bspx\b|wall street(?! journal)|stock market|dow jones|equities/iu, STRONG, "{hit} moves are what traders weigh for the S&P: \"{label}\" is at {pct}."),
  cue(/\bstocks?\b/iu, MEDIUM, "Stock moves are what traders weigh for the S&P: \"{label}\" is at {pct}."),
  cue(/\brall(y|ies|ied)\b|sell-?off|surge[sd]?\b/iu, WEAK, "The stock swing is what traders weigh for the S&P: \"{label}\" is at {pct}."),
];

const nominee = (party: RegExp, partyReason: string): readonly Cue[] => [
  cue(party, WEAK, partyReason),
  cue(/nominee|nomination|primar(y|ies)|presidential/iu, MEDIUM, partyReason),
  cue(/\b2028\b/u, MEDIUM, partyReason),
];

const vice = (party: RegExp): readonly Cue[] => [
  cue(/vice[- ]president|\bvp\b|running mate|\bticket\b/iu, MEDIUM, "Running-mate buzz has traders pricing {label} at {pct} for the VP slot."),
  cue(party, WEAK, "Running-mate buzz has traders pricing {label} at {pct} for the VP slot."),
  cue(/\b2028\b/u, MEDIUM, "Running-mate buzz has traders pricing {label} at {pct} for the VP slot."),
];

const asset = (tickers: RegExp, cues: readonly Cue[], fallback: Fallback = "even-odds"): Topic => ({
  tickers,
  cues,
  numbers: "amounts",
  fallback,
  nearestExpiry: true,
});

const PRICE_MOVE = /\bprices?\b|\$\d|sells?\b|selling|dump(s|ed|ing)?\b|rall(y|ies)|surge[sd]?\b|plunge[sd]?|crash(es|ed)?|\babove\b|\bbelow\b|\bhits?\b|\btops?\b/iu;
const CRYPTO_MOVE = cue(PRICE_MOVE, WEAK, "{hit} price action is why traders put \"{label}\" at {pct} for {title}.");
const ASSET_MOVE = (name: string): Cue => cue(PRICE_MOVE, WEAK, `${name} price action is why traders put "{label}" at {pct}.`);

export const TOPICS: readonly Topic[] = [
  {
    tickers: /^FED\d/u,
    cues: [
      cue(/powell|warsh|fed chair/iu, STRONG, "{hit}'s comments are why traders price \"{label}\" at {pct} for December."),
      cue(/\bfed\b|fomc|federal reserve/iu, MEDIUM, FED_RATE),
      cue(/rate (hike|cut)s?|(hike|cut|raise|lower|hold)s? (interest )?rates?|basis points?|\bbps\b|interest rates?|monetary policy/iu, STRONG, FED_RATE),
      cue(/inflation|\bcpi\b|\bppi\b|\bpce\b/iu, WEAK, "Inflation data is feeding the Fed call, where \"{label}\" is priced at {pct}."),
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
      cue(/nasdaq|\bqqq\b/iu, STRONG, "{hit} moves are why traders price \"{label}\" at {pct} for the 2026 close."),
      cue(/tech stocks|magnificent seven/iu, STRONG, "Tech-stock moves are why traders price \"{label}\" at {pct} for the 2026 close."),
      cue(/big tech|nvidia|semiconductor/iu, MEDIUM, "Chip and tech news is why traders price \"{label}\" at {pct} for the 2026 close."),
    ],
    numbers: "amounts",
    fallback: "even-odds",
  },
  { tickers: /^SPXEND/u, cues: SPX_GENERIC, numbers: "amounts", fallback: "even-odds" },
  {
    tickers: /^SPXHIGH/u,
    cues: [
      ...SPX_GENERIC,
      cue(/record high|all-time high|new high|rall(y|ies|ied)\b|surge[sd]?\b/iu, MEDIUM, "A rally keeps \"{label}\" for the S&P's high at {pct}."),
    ],
    numbers: "amounts",
    fallback: "even-odds",
  },
  {
    tickers: /^SPXLOW/u,
    cues: [
      ...SPX_GENERIC,
      cue(/sell-?off|plunge[sd]?|crash(es|ed)?|correction|bear market|tumble[sd]?/iu, MEDIUM, "A sell-off is why traders price \"{label}\" for the S&P's low at {pct}."),
    ],
    numbers: "amounts",
    fallback: "even-odds",
  },
  {
    tickers: /^HORMUZ/u,
    cues: [
      cue(/hormuz/iu, STRONG, "{hit} headlines decide it: traders price \"{label}\" for normal traffic at {pct}."),
      cue(/\biran(ian)?\b|tankers?|shipping lanes?|persian gulf|blockade/iu, MEDIUM, "Gulf shipping news is why traders price \"{label}\" for Hormuz at {pct}."),
    ],
    fallback: "even-odds",
  },
  {
    tickers: /^UNEMP/u,
    cues: [
      cue(/unemployment|jobless|jobs report|non-?farm|payrolls?/iu, STRONG, "Jobs data is the driver here; \"{label}\" for 2026 unemployment is priced at {pct}."),
      cue(/layoffs?|job (losses|cuts)|labor market|hiring/iu, MEDIUM, "Labor-market news is why \"{label}\" for 2026 unemployment is priced at {pct}."),
    ],
    numbers: "percents",
    fallback: "even-odds",
  },
  {
    tickers: /^RECESSION/u,
    cues: [
      cue(/recession|stagflation|economy (shrinks?|shrank|contracts?|contracted)|negative growth/iu, STRONG, "Recession talk is why the market prices a 2026 recession at {pct}."),
      cue(/downturn|slowdown|layoffs?/iu, MEDIUM, "Slowdown signals are why the market prices a 2026 recession at {pct}."),
    ],
    fallback: "favourite",
  },
  {
    tickers: /^GDP/u,
    cues: [
      cue(/\bgdp\b|gross domestic product/iu, STRONG, "GDP data is the driver; \"{label}\" for 2026 growth is priced at {pct}."),
      cue(/economic growth|economy (grew|grows|shrinks?|shrank|expands?|expanded|contracts?)/iu, MEDIUM, "Growth data is why \"{label}\" for 2026 GDP is priced at {pct}."),
    ],
    numbers: "percents",
    fallback: "even-odds",
  },
  asset(/^WTI\d/u, [
    cue(/\bwti\b|west texas|crude oil/iu, STRONG, "{hit} moves are why traders put \"{label}\" for WTI at {pct}."),
    cue(/\boil\b|crude|opec|barrels?|petroleum/iu, MEDIUM, "Oil headlines are why traders put \"{label}\" for WTI at {pct}."),
    ASSET_MOVE("Oil"),
  ]),
  asset(/^BRENT\d/u, [
    cue(/brent/iu, STRONG, "{hit} moves are why traders put \"{label}\" for Brent at {pct}."),
    cue(/crude|\boil\b|opec|barrels?/iu, MEDIUM, "Oil headlines are why traders put \"{label}\" for Brent at {pct}."),
    ASSET_MOVE("Oil"),
  ]),
  asset(/^XAU\d/u, [
    cue(/gold price|price of gold|\bxau\b|bullion/iu, STRONG, "{hit} moves are why traders put \"{label}\" for gold at {pct}."),
    cue(/\bgold\b/iu, MEDIUM, "Gold's move is why traders put \"{label}\" at {pct}."),
    cue(/precious metals?|safe[- ]haven/iu, MEDIUM, "Safe-haven demand is why traders put \"{label}\" for gold at {pct}."),
    ASSET_MOVE("Gold"),
  ]),
  asset(/^XAG\d/u, [
    cue(/silver price|price of silver|\bxag\b/iu, STRONG, "{hit} moves are why traders put \"{label}\" for silver at {pct}."),
    cue(/\bsilver\b/iu, MEDIUM, "Silver's move is why traders put \"{label}\" at {pct}."),
    cue(/precious metals?/iu, MEDIUM, "Precious-metals flows are why traders put \"{label}\" for silver at {pct}."),
    ASSET_MOVE("Silver"),
  ]),
  asset(/^COPPER\d/u, [cue(/copper/iu, MEDIUM, "Copper's move is why traders put \"{label}\" at {pct}."), ASSET_MOVE("Copper")]),
  asset(/^NGAS\d/u, [cue(/natural gas|nat gas|\blng\b|henry hub/iu, STRONG, "{hit} moves are why traders put \"{label}\" for natural gas at {pct}.")]),
  asset(/^BTC\d/u, [
    cue(/bitcoin|\bbtc\b/iu, STRONG, "{hit} headlines are why traders put \"{label}\" at {pct} for {title}."),
    cue(/crypto(currency|currencies)?\b/iu, MEDIUM, "Crypto-wide moves are why traders put \"{label}\" at {pct} for Bitcoin."),
    CRYPTO_MOVE,
  ]),
  asset(/^ETH\d/u, [cue(/ethereum|\bether\b|\beth\b|vitalik/iu, STRONG, "{hit} headlines are why traders put \"{label}\" at {pct} for {title}."), CRYPTO_MOVE]),
  asset(/^SOL\d/u, [cue(/solana/iu, STRONG, "{hit} headlines are why traders put \"{label}\" at {pct} for {title}."), cue(/\bsol\b/iu, MEDIUM, "SOL's move is why traders put \"{label}\" at {pct}."), CRYPTO_MOVE]),
  asset(/^XRP\d/u, [cue(/\bxrp\b|ripple/iu, STRONG, "{hit} headlines are why traders put \"{label}\" at {pct} for {title}."), CRYPTO_MOVE]),
  asset(/^HYPE\d/u, [cue(/hyperliquid|\$hype\b/iu, STRONG, "{hit} headlines are why traders put \"{label}\" at {pct} for {title}."), CRYPTO_MOVE]),
  asset(/^ZEC\d/u, [cue(/zcash|\bzec\b/iu, STRONG, "{hit} headlines are why traders put \"{label}\" at {pct} for {title}."), CRYPTO_MOVE]),
  {
    tickers: /^CRYPTOSTRUCT/u,
    cues: [
      cue(/clarity act|market structure|stablecoin bill|genius act|crypto (bill|legislation|law|regulation)|digital asset (bill|legislation)/iu, STRONG, "A stall on the {hit} keeps odds of it becoming law at {pct}."),
      cue(/\bsenate\b|\bsec\b|congress|lawmakers/iu, WEAK, "Washington's crypto rulemaking keeps odds of a structure law at {pct}."),
      cue(/crypto/iu, WEAK, "Washington's crypto rulemaking keeps odds of a structure law at {pct}."),
    ],
    fallback: "favourite",
  },
  { tickers: /^SAVEACT/u, cues: [cue(/\bsave act\b/iu, STRONG, "Votes and rulings on the {hit} are why odds it becomes law sit at {pct}.")], fallback: "favourite" },
  {
    tickers: /^BUYGREEN/u,
    cues: [
      cue(/greenland/iu, STRONG, "{hit} headlines are why odds of a US purchase sit at {pct} ({label})."),
      cue(/arctic|denmark|nuuk/iu, MEDIUM, "Arctic diplomacy is why odds of a US Greenland purchase sit at {pct} ({label})."),
    ],
    fallback: "even-odds",
  },
  {
    tickers: /^ALITORETIRE/u,
    cues: [
      cue(/alito|(supreme court|scotus).{0,40}(retire|vacan|step(s|ping)? down)|(retire|vacan).{0,40}(supreme court|scotus)/iu, STRONG, "Retirement talk puts an Alito exit \"{label}\" at {pct}."),
    ],
    fallback: "even-odds",
  },
  {
    tickers: /^NASAMOON/u,
    cues: [
      cue(/artemis|\bnasa\b|moon landing|lunar/iu, STRONG, "{hit} news is why a NASA moon landing \"{label}\" is priced at {pct}."),
      cue(/\bmoon\b|\borion\b|\bsls\b/iu, MEDIUM, "Moon-mission news is why a NASA landing \"{label}\" is priced at {pct}."),
    ],
    fallback: "even-odds",
  },
  {
    tickers: /^ZECEXPLOIT/u,
    cues: [
      cue(/zcash|\bzec\b|orchard (pool|shielded|protocol)/iu, STRONG, "Zcash security talk keeps odds Orchard is proven safe at {pct}."),
      cue(/vulnerabilit|exploit/iu, MEDIUM, "A security finding keeps odds Orchard is proven safe at {pct}."),
    ],
    fallback: "favourite",
  },
  {
    tickers: /^BESTAI/u,
    cues: [
      cue(/best ai|ai leaderboard|intelligence index|lmarena|chatbot arena|artificial analysis/iu, STRONG, "{hit} results are why {label} is priced at {pct} for best AI of 2026."),
      cue(/ai models?|frontier models?|\bllms?\b/iu, MEDIUM, "Model news is why {label} is priced at {pct} for best AI of 2026."),
      cue(/anthropic|openai|deepmind|\bxai\b|meta ai|alibaba|baidu/iu, WEAK, "Lab news has {label} at {pct} for best AI of 2026."),
      cue(/claude|gemini|\bgpt-?\d|chatgpt|grok|llama|qwen|deepseek|ernie|fable|opus/iu, WEAK, "{hit} news has {label} at {pct} for best AI of 2026."),
      cue(/benchmark|top spot|takes the crown|leaderboard|\bsota\b/iu, MEDIUM, "Leaderboard moves put {label} at {pct} for best AI of 2026."),
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
      cue(/dune:? part (three|3)/iu, STRONG, "{hit} reviews are why \"{label}\" on Rotten Tomatoes is priced at {pct}."),
      cue(/\bdune\b/iu, MEDIUM, "Dune reaction is why \"{label}\" on Rotten Tomatoes is priced at {pct}."),
      cue(/rotten tomatoes|box office|critics|villeneuve/iu, MEDIUM, "Critic reaction is why \"{label}\" on Rotten Tomatoes is priced at {pct}."),
    ],
    numbers: "percents",
    fallback: "even-odds",
  },
  {
    tickers: /^AVENGERSDOOMSDAY/u,
    cues: [
      cue(/avengers:? doomsday/iu, STRONG, "{hit} reviews are why \"{label}\" on Rotten Tomatoes is priced at {pct}."),
      cue(/avengers|doomsday/iu, MEDIUM, "Early reaction is why \"{label}\" on Rotten Tomatoes is priced at {pct}."),
      cue(/rotten tomatoes|box office|critics|marvel|\bmcu\b/iu, MEDIUM, "Critic reaction is why \"{label}\" on Rotten Tomatoes is priced at {pct}."),
    ],
    numbers: "percents",
    fallback: "even-odds",
  },
  {
    tickers: /^GOTY/u,
    cues: [
      cue(/game awards|\bgoty\b|game of the year|keighley/iu, STRONG, "Game Awards buzz has {label} at {pct} for 2026 Game of the Year."),
      cue(/\bgta\s?(vi|6)\b|rockstar|grand theft auto/iu, STRONG, "{hit} news has {label} at {pct} for 2026 Game of the Year."),
    ],
    contractCues: [{ post: /\bgta\s?(vi|6)\b|rockstar/iu, label: /grand theft auto/iu }],
    names: "standalone",
    fallback: "favourite",
  },
  {
    tickers: /^PRES2028/u,
    cues: [
      cue(/\b2028\b/u, MEDIUM, "2028 chatter has {label} at {pct} to win the presidency."),
      cue(/presidential (run|bid|race|campaign|hopeful|candidate)|run for president|white house (run|bid)/iu, MEDIUM, "Run talk has {label} at {pct} to win the presidency."),
    ],
    names: "needs-context",
    fallback: "favourite",
  },
  { tickers: /^DEMNOM/u, cues: nominee(/democrat(ic|s)?|\bdems\b/iu, "Primary buzz has {label} at {pct} for the 2028 Democratic nomination."), names: "needs-context", fallback: "favourite" },
  { tickers: /^REPNOM/u, cues: nominee(/republican|\bgop\b/iu, "Primary buzz has {label} at {pct} for the 2028 Republican nomination."), names: "needs-context", fallback: "favourite" },
  { tickers: /^GOPVP/u, cues: vice(/republican|\bgop\b/iu), names: "needs-context", fallback: "favourite" },
  { tickers: /^DEMVP/u, cues: vice(/democrat(ic|s)?|\bdems\b/iu), names: "needs-context", fallback: "favourite" },
  {
    tickers: /^CABINET/u,
    cues: [
      cue(/cabinet|administration|secretary/iu, MEDIUM, "Cabinet talk puts {label} at {pct} to leave the administration."),
      cue(/resign(s|ed|ation)?|fired|ousted|steps? down|quits?|departure|leaves/iu, MEDIUM, "Departure talk puts {label} at {pct} to leave the administration."),
    ],
    names: "needs-context",
    fallback: "favourite",
  },
  {
    tickers: /^LEAVE/u,
    cues: [
      cue(/resign(s|ed|ation)?|steps? down|ousted|leaves? office|no[- ]confidence|prime minister|president/iu, MEDIUM, "Leadership turmoil puts {label} at {pct} to leave office in 2026."),
    ],
    names: "needs-context",
    fallback: "favourite",
  },
  {
    tickers: /^DIAZCANEL/u,
    cues: [
      cue(/d[ií]az-?canel/iu, STRONG, "{hit} headlines put \"{label}\" for his exit at {pct}."),
      cue(/\bcuba(n)?\b/iu, MEDIUM, "Cuban leadership news puts \"{label}\" for Díaz-Canel's exit at {pct}."),
    ],
    fallback: "even-odds",
  },
  {
    tickers: /^FEDCRIME/u,
    cues: [cue(/charged|indict(ed|ment)|arrest(ed)?|prosecut|grand jury|\bdoj\b|justice department/iu, MEDIUM, "Prosecution talk puts {label} at {pct} to be charged in 2026.")],
    names: "needs-context",
    fallback: "favourite",
  },
  {
    tickers: /^ILPM/u,
    cues: [cue(/israel(i)?|knesset|prime minister/iu, MEDIUM, "Israeli election talk puts {label} at {pct} to be the next prime minister.")],
    names: "needs-context",
    fallback: "favourite",
  },
  {
    tickers: /^FRA\d/u,
    cues: [cue(/france|french|[ée]lys[ée]e|presidential/iu, MEDIUM, "French election talk puts {label} at {pct} to win in 2027.")],
    names: "needs-context",
    fallback: "favourite",
  },
  {
    tickers: /^UKGEN/u,
    cues: [cue(/\buk\b|britain|british|general election|westminster|starmer|farage|downing street/iu, MEDIUM, "UK polling talk puts {label} at {pct} to win the next general election.")],
    names: "needs-context",
    fallback: "favourite",
  },
  {
    tickers: /^(HOUSE|SEN)\d/u,
    cues: [cue(/house (race|seat|election|district)|senate (race|seat|election)|midterms?|congressional|special election|\brep\b/iu, MEDIUM, "Race news puts {label} at {pct} to win this 2026 seat.")],
    names: "needs-context",
    fallback: "favourite",
  },
];
