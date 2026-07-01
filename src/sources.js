export const OFFICIAL_SOURCES = [
  {
    id: "nerc",
    name: "НКРЕКП",
    listingUrl: "https://www.nerc.gov.ua/news",
    hosts: ["nerc.gov.ua"],
    articlePathPattern: /^\/news\//,
    sitemapUrl:
      "https://www.nerc.gov.ua/sitemap-rainlabblogmodelspost-1.xml",
  },
  {
    id: "cabinet",
    name: "Кабінет Міністрів України",
    listingUrl: "https://www.kmu.gov.ua/news",
    hosts: ["kmu.gov.ua"],
    articlePathPattern: /^\/news\//,
  },
  {
    id: "rada",
    name: "Верховна Рада України",
    listingUrl: "https://www.rada.gov.ua/news/Novyny/",
    hosts: ["rada.gov.ua", "zakon.rada.gov.ua"],
    articlePathPattern: /^\/news\//,
    feedUrl: "https://www.rada.gov.ua/rss/news",
  },
  {
    id: "rada_ecology",
    name: "Комітет ВРУ з питань екологічної політики",
    listingUrl: "https://komekolog.rada.gov.ua/news/",
    hosts: ["komekolog.rada.gov.ua"],
    articlePathPattern: /^\/news\//,
    feedUrl: "https://komekolog.rada.gov.ua/rss/news",
  },
  {
    id: "rada_local_government",
    name: "Комітет ВРУ з питань місцевого самоврядування",
    listingUrl: "https://komsamovr.rada.gov.ua/news/",
    hosts: ["komsamovr.rada.gov.ua"],
    articlePathPattern: /^\/news\//,
    feedUrl: "https://komsamovr.rada.gov.ua/rss/news",
  },
  {
    id: "mindev",
    name: "Міністерство розвитку громад та територій України",
    listingUrl: "https://mindev.gov.ua/news",
    hosts: ["mindev.gov.ua"],
    articlePathPattern: /^\/news\//,
  },
  {
    id: "davr",
    name: "Державне агентство водних ресурсів України",
    listingUrl: "https://www.davr.gov.ua/news",
    hosts: ["davr.gov.ua"],
    articlePathPattern: /^\/news\//,
  },
  {
    id: "auc",
    name: "Асоціація міст України",
    listingUrl: "https://auc.org.ua/news",
    hosts: ["auc.org.ua"],
    articlePathPattern: /^\/novyna\//,
    feedUrl: "https://auc.org.ua/rss.xml",
  },
];

export function sourceForUrl(value) {
  const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  return OFFICIAL_SOURCES.find((source) =>
    source.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)),
  );
}
