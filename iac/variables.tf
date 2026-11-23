variable "cloudflare_account_id" {
  description = "Cloudflare account id (never committed): TF_VAR_cloudflare_account_id"
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token of this repo: TF_VAR_cloudflare_api_token"
  type        = string
  sensitive   = true
}
