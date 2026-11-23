## The Worker's code is deployed by wrangler (`make scheduler-deploy`, which comes first: the script
## must exist). Terraform owns what is around it: the cron triggers and the workers.dev subdomain.
## Keep `crons` in step with WORKFLOWS in scheduler/src/dispatch.ts (a test compares them).

locals {
  script_name = "veille-llm-scheduler"
  crons = [
    "0 6 * * *", # daily.yml, every day 06:00 UTC
    "0 8 * * 1", # weekly.yml, Monday 08:00 UTC
  ]
}

resource "cloudflare_workers_cron_trigger" "scheduler" {
  account_id  = var.cloudflare_account_id
  script_name = local.script_name
  schedules   = [for cron in local.crons : { cron = cron }]
}

resource "cloudflare_workers_script_subdomain" "scheduler" {
  account_id  = var.cloudflare_account_id
  script_name = local.script_name
  enabled     = false
}
