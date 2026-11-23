## Terraform state lives on Cloudflare R2 (s3 backend, custom endpoint). The bucket must exist before
## `terraform init`: setup/bootstrap.sh creates it (see setup/README.md). One environment only (prod).

terraform {
  backend "s3" {
    bucket                      = "veille-llm-tfstate"
    key                         = "scheduler/terraform.tfstate"
    region                      = "auto"
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_path_style              = true
    # The R2 endpoint and the keys are not written here: `make tf-init` passes the endpoint
    # (-backend-config) and AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY carry the R2 keys.
  }
}
