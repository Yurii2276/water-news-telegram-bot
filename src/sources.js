export const OFFICIAL_SOURCES = [
  {
    id: "nerc",
    category: "regulator",
    name: "НКРЕКП",
    listingUrl: "https://www.nerc.gov.ua/news",
    hosts: ["nerc.gov.ua"],
    articlePathPattern: /^\/news\//,
    sitemapUrl:
      "https://www.nerc.gov.ua/sitemap-rainlabblogmodelspost-1.xml",
  },
  {
    id: "cabinet",
    category: "government",
    name: "Кабінет Міністрів України",
    listingUrl: "https://www.kmu.gov.ua/news",
    hosts: ["kmu.gov.ua"],
    articlePathPattern: /^\/news\//,
  },
  {
    id: "rada",
    category: "parliament",
    name: "Верховна Рада України",
    listingUrl: "https://www.rada.gov.ua/news/Novyny/",
    hosts: ["rada.gov.ua", "zakon.rada.gov.ua"],
    articlePathPattern: /^\/news\//,
    feedUrl: "https://www.rada.gov.ua/rss/news",
  },
  {
    id: "rada_ecology",
    category: "parliament",
    name: "Комітет ВРУ з питань екологічної політики",
    listingUrl: "https://komekolog.rada.gov.ua/news/",
    hosts: ["komekolog.rada.gov.ua"],
    articlePathPattern: /^\/news\//,
    feedUrl: "https://komekolog.rada.gov.ua/rss/news",
  },
  {
    id: "rada_local_government",
    category: "parliament",
    name: "Комітет ВРУ з питань місцевого самоврядування",
    listingUrl: "https://komsamovr.rada.gov.ua/news/",
    hosts: ["komsamovr.rada.gov.ua"],
    articlePathPattern: /^\/news\//,
    feedUrl: "https://komsamovr.rada.gov.ua/rss/news",
  },
  {
    id: "mindev",
    category: "government",
    name: "Міністерство розвитку громад та територій України",
    listingUrl: "https://mindev.gov.ua/news",
    hosts: ["mindev.gov.ua"],
    articlePathPattern: /^\/news\//,
  },
  {
    id: "davr",
    category: "government",
    name: "Державне агентство водних ресурсів України",
    listingUrl: "https://www.davr.gov.ua/news",
    hosts: ["davr.gov.ua"],
    articlePathPattern: /^\/news\//,
  },
  {
    id: "auc",
    category: "association",
    name: "Асоціація міст України",
    listingUrl: "https://auc.org.ua/news",
    hosts: ["auc.org.ua"],
    articlePathPattern: /^\/novyna\//,
    feedUrl: "https://auc.org.ua/rss.xml",
  },
  {
    id: "ukrvodokanal",
    category: "association",
    name: "Ukrainian water utilities association",
    listingUrl: "https://ukrvodokanal.in.ua/",
    hosts: ["ukrvodokanal.in.ua"],
  },
  {
    id: "unicef_ukraine",
    category: "donor",
    name: "UNICEF Ukraine",
    listingUrl: "https://www.unicef.org/ukraine/en/press-releases",
    hosts: ["unicef.org"],
  },
  {
    id: "world_bank_ukraine",
    category: "donor",
    name: "World Bank Ukraine",
    listingUrl: "https://www.worldbank.org/en/country/ukraine/news",
    hosts: ["worldbank.org"],
  },
  {
    id: "ebrd_ukraine",
    category: "donor",
    name: "EBRD Ukraine",
    listingUrl: "https://www.ebrd.com/news-and-events/news.html",
    hosts: ["ebrd.com"],
  },
  {
    id: "undp_ukraine",
    category: "donor",
    name: "UNDP Ukraine",
    listingUrl: "https://www.undp.org/ukraine/press-releases",
    hosts: ["undp.org"],
  },
  {
    id: "usaid_ukraine",
    category: "donor",
    name: "USAID Ukraine",
    listingUrl: "https://www.usaid.gov/ukraine/newsroom",
    hosts: ["usaid.gov"],
  },
  {
    id: "eu_ukraine_facility",
    category: "donor",
    name: "EU Ukraine Facility",
    listingUrl: "https://neighbourhood-enlargement.ec.europa.eu/news_en",
    hosts: ["europa.eu"],
  },
];

export const GOOGLE_NEWS_SOURCE_CATEGORY = "general_news";

export function sourceCategoryForId(sourceId) {
  if (sourceId === "google_news") return GOOGLE_NEWS_SOURCE_CATEGORY;
  return OFFICIAL_SOURCES.find((source) => source.id === sourceId)?.category ?? null;
}

export function sourceForUrl(value) {
  const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  return OFFICIAL_SOURCES.find((source) =>
    source.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)),
  );
}
