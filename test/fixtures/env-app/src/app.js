// The app reaches its environment in three spellings across the tree.
const api = process.env.API_URL || "/api";
const region = process.env["REGION"];
const flag = process.env.FEATURE_BETA ?? false;

export function boot() {
  const tenant = window.__ENV__.TENANT;
  const theme = window.appConfig.theme;
  return fetch(`${api}/orders`, { headers: { "x-tenant": tenant, "x-region": region, "x-theme": theme } }).then(() => flag);
}
