import { DomainError } from "./core.js";

export function createPublishingOAuthRouter(providers = {}) {
  const provider = platform => { const value = providers[platform]; if (!value) throw new DomainError("PUBLISHING_OAUTH_UNAVAILABLE", `${platform} publishing OAuth is not configured`, 503); return value; };
  const owner = (tenantId, bindingId) => Object.values(providers).find(value => value.accounts({ tenantId }).some(item => item.accountId === bindingId));
  return Object.freeze({
    begin(input) { return provider(input.platform).begin(input); },
    complete(input) { return provider(input.platform).complete(input); },
    disconnect(input) { const value = owner(input.tenantId, input.bindingId); if (!value) throw new DomainError("PUBLISHING_ACCOUNT_NOT_FOUND", "publishing account not found", 404); return value.disconnect(input); },
    accessToken(tenantId, bindingId) { const value = owner(tenantId, bindingId); if (!value) throw new DomainError("PUBLISHING_ACCOUNT_NOT_FOUND", "publishing account not found", 404); return value.accessToken(tenantId, bindingId); },
    accounts(input) { return Object.values(providers).flatMap(value => value.accounts(input)); }
  });
}
