export const sampleAlerts = [
  {
    id: "sample-1",
    ip: "45.155.205.233",
    country: "RU",
    city: "Moscow",
    latitude: 55.7558,
    longitude: 37.6173,
    scenario: "crowdsecurity/ssh-bf",
    decisionType: "ban",
    value: "45.155.205.233",
    createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    count: 8
  },
  {
    id: "sample-2",
    ip: "185.220.101.31",
    country: "DE",
    city: "Frankfurt am Main",
    latitude: 50.1109,
    longitude: 8.6821,
    scenario: "crowdsecurity/http-probing",
    decisionType: "captcha",
    value: "185.220.101.31",
    createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    count: 4
  },
  {
    id: "sample-3",
    ip: "103.151.172.28",
    country: "ID",
    city: "Jakarta",
    latitude: -6.2088,
    longitude: 106.8456,
    scenario: "crowdsecurity/nginx-req-limit-exceeded",
    decisionType: "ban",
    value: "103.151.172.28",
    createdAt: new Date(Date.now() - 1000 * 60 * 31).toISOString(),
    count: 15
  },
  {
    id: "sample-4",
    ip: "191.96.71.82",
    country: "BR",
    city: "Sao Paulo",
    latitude: -23.5558,
    longitude: -46.6396,
    scenario: "crowdsecurity/http-crawl-non_statics",
    decisionType: "ban",
    value: "191.96.71.82",
    createdAt: new Date(Date.now() - 1000 * 60 * 47).toISOString(),
    count: 6
  },
  {
    id: "sample-5",
    ip: "104.248.88.184",
    country: "US",
    city: "New York",
    latitude: 40.7128,
    longitude: -74.006,
    scenario: "crowdsecurity/ssh-slow-bf",
    decisionType: "ban",
    value: "104.248.88.184",
    createdAt: new Date(Date.now() - 1000 * 60 * 62).toISOString(),
    count: 11
  }
];
