# DentaBill API on AWS:
#   CloudFront -> Lambda Function URL (response streaming, for SSE)
#     -> Fastify API (apps/api, Lambda Web Adapter)
#   API --SendMessage--> SQS jobs queue --> worker Lambda (call.place, summary.generate)
#                            \-- after 3 receives --> DLQ (alarm)
#   Both functions -> shared Aurora Serverless v2 (platform stack, ~/code/aws-platform).
#
# Build first: pnpm --filter @dentabill/api build:lambda   (apps/api/dist-lambda/*.zip)
# Runbook: README.md

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  backend "s3" {
    bucket       = "tfstate-481912007673-use1"
    key          = "dentabill/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = { project = "dentabill", managed_by = "terraform" }
  }
}

data "terraform_remote_state" "platform" {
  backend = "s3"
  config = {
    bucket = "tfstate-481912007673-use1"
    key    = "platform/terraform.tfstate"
    region = "us-east-1"
  }
}

variable "api_domain" {
  description = "Custom domain for CloudFront, e.g. api.usedentabill.xyz. Empty until the certificate is wanted."
  type        = string
  default     = "api.usedentabill.xyz"
}

variable "app_url" {
  type    = string
  default = "https://usedentabill.xyz"
}

variable "public_api_url" {
  type    = string
  default = "https://api.usedentabill.xyz"
}

locals {
  name     = "dentabill"
  platform = data.terraform_remote_state.platform.outputs
  dist     = "${path.module}/../../apps/api/dist-lambda"
  # Must match the worker's JOBS_MAX_RECEIVE_COUNT (default 3).
  max_receive_count = 3
}

# ---------------------------------------------------------------- secrets

# Clerk keys are copied in by hand (scripts/owner-step.sh in aws-platform).
data "aws_secretsmanager_secret_version" "clerk" {
  secret_id = "dentabill/clerk"
}

resource "random_password" "db_role" {
  length  = 40
  special = false
}

resource "random_password" "dob_hash" {
  length  = 64
  special = false
}

resource "random_password" "retell_webhook" {
  length  = 48
  special = false
}

locals {
  clerk = jsondecode(data.aws_secretsmanager_secret_version.clerk.secret_string)
  # Small Prisma pool per Lambda instance; Aurora caps connections by ACU.
  database_url = "postgresql://dentabill_app:${random_password.db_role.result}@${local.platform.db_endpoint}:5432/dentabill?sslmode=require&connection_limit=3&pool_timeout=30&connect_timeout=30"
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "dentabill/app"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_URL          = local.database_url
    DB_ROLE_PASSWORD      = random_password.db_role.result
    DOB_HASH_SECRET       = random_password.dob_hash.result
    RETELL_WEBHOOK_SECRET = random_password.retell_webhook.result
  })
}

# ---------------------------------------------------------------- queue

resource "aws_sqs_queue" "jobs_dlq" {
  name                      = "${local.name}-jobs-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "jobs" {
  name = "${local.name}-jobs"
  # >= the worker timeout (AWS requirement for Lambda event sources).
  visibility_timeout_seconds = 960
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = local.max_receive_count
  })
}

# ---------------------------------------------------------------- functions

locals {
  common_env = {
    NODE_ENV               = "production"
    NODE_OPTIONS           = "--enable-source-maps"
    DATABASE_URL           = local.database_url
    JOB_DISPATCH_MODE      = "sqs"
    JOBS_QUEUE_URL         = aws_sqs_queue.jobs.url
    JOBS_MAX_RECEIVE_COUNT = tostring(local.max_receive_count)
    NEXT_PUBLIC_APP_URL    = var.app_url
    NEXT_PUBLIC_API_URL    = var.public_api_url
    # Demo mode: no real telephony or LLM keys are configured.
    DEMO_AUTOPILOT                     = "true"
    DEMO_SUMMARIZER_FALLBACK           = "true"
    DEMO_IGNORE_PAYER_HOURS            = "true"
    SUMMARIZER_AUTO_TRANSITION_ENABLED = "true"
  }
}

resource "aws_iam_role" "fn" {
  for_each = toset(["api", "worker"])
  name     = "${local.name}-${each.key}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "fn_vpc" {
  for_each   = aws_iam_role.fn
  role       = each.value.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "api_sqs" {
  role = aws_iam_role.fn["api"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage"]
      Resource = aws_sqs_queue.jobs.arn
    }]
  })
}

resource "aws_iam_role_policy" "worker_sqs" {
  role = aws_iam_role.fn["worker"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes",
        "sqs:ChangeMessageVisibility", "sqs:SendMessage",
      ]
      Resource = aws_sqs_queue.jobs.arn
    }]
  })
}

resource "aws_cloudwatch_log_group" "fn" {
  for_each          = toset(["api", "worker"])
  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = 14
}

resource "aws_lambda_function" "api" {
  function_name = "${local.name}-api"
  role          = aws_iam_role.fn["api"].arn
  runtime       = "nodejs22.x"
  architectures = ["x86_64"] # Prisma engine in the bundle is rhel-openssl-3.0.x
  handler       = "run.sh"
  memory_size   = 1024
  timeout       = 900 # SSE streams run up to 780 s

  filename         = "${local.dist}/api.zip"
  source_code_hash = filebase64sha256("${local.dist}/api.zip")
  layers           = ["arn:aws:lambda:us-east-1:753240598075:layer:LambdaAdapterLayerX86:30"]

  vpc_config {
    subnet_ids         = local.platform.private_subnet_ids
    security_group_ids = [local.platform.db_client_security_group_id]
  }

  environment {
    variables = merge(local.common_env, {
      AWS_LAMBDA_EXEC_WRAPPER      = "/opt/bootstrap"
      AWS_LWA_PORT                 = "8080"
      AWS_LWA_INVOKE_MODE          = "response_stream"
      AWS_LWA_READINESS_CHECK_PATH = "/v1/healthz"
      AWS_LWA_ASYNC_INIT           = "true"
      PORT                         = "8080"
      API_CORS_ORIGINS             = var.app_url
      CLERK_SECRET_KEY             = local.clerk.CLERK_SECRET_KEY
      CLERK_PUBLISHABLE_KEY        = local.clerk.CLERK_PUBLISHABLE_KEY
      DOB_HASH_SECRET              = random_password.dob_hash.result
      RETELL_WEBHOOK_SECRET        = random_password.retell_webhook.result
    })
  }

  depends_on = [aws_cloudwatch_log_group.fn, aws_iam_role_policy_attachment.fn_vpc]
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE"
  invoke_mode        = "RESPONSE_STREAM"
}

resource "aws_lambda_function" "worker" {
  function_name = "${local.name}-worker"
  role          = aws_iam_role.fn["worker"].arn
  runtime       = "nodejs22.x"
  architectures = ["x86_64"]
  handler       = "index.handler"
  memory_size   = 1024
  timeout       = 900

  filename         = "${local.dist}/worker.zip"
  source_code_hash = filebase64sha256("${local.dist}/worker.zip")

  vpc_config {
    subnet_ids         = local.platform.private_subnet_ids
    security_group_ids = [local.platform.db_client_security_group_id]
  }

  environment {
    variables = local.common_env
  }

  depends_on = [aws_cloudwatch_log_group.fn, aws_iam_role_policy_attachment.fn_vpc]
}

resource "aws_lambda_event_source_mapping" "jobs" {
  event_source_arn        = aws_sqs_queue.jobs.arn
  function_name           = aws_lambda_function.worker.arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
  scaling_config {
    # Bounds DB connections and concurrent phone calls.
    maximum_concurrency = 5
  }
  depends_on = [aws_iam_role_policy.worker_sqs]
}

# ---------------------------------------------------------------- edge

resource "aws_acm_certificate" "api" {
  count             = var.api_domain == "" ? 0 : 1
  domain_name       = var.api_domain
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_cloudfront_distribution" "api" {
  enabled         = true
  comment         = "DentaBill API"
  price_class     = "PriceClass_100"
  http_version    = "http2and3"
  is_ipv6_enabled = true
  aliases         = var.api_domain == "" ? [] : [var.api_domain]

  origin {
    origin_id   = "api"
    domain_name = trimsuffix(trimprefix(aws_lambda_function_url.api.function_url, "https://"), "/")
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      # Time to first byte and between bytes; SSE sends heartbeats.
      origin_read_timeout      = 60
      origin_keepalive_timeout = 60
    }
  }

  default_cache_behavior {
    target_origin_id       = "api"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    # No compression: it would buffer the SSE stream.
    compress = false
    # Managed policies: CachingDisabled, AllViewerExceptHostHeader.
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.api_domain == ""
    acm_certificate_arn            = var.api_domain == "" ? null : aws_acm_certificate.api[0].arn
    ssl_support_method             = var.api_domain == "" ? null : "sni-only"
    minimum_protocol_version       = var.api_domain == "" ? null : "TLSv1.2_2021"
  }
}

# ---------------------------------------------------------------- alarms

resource "aws_cloudwatch_metric_alarm" "dlq" {
  alarm_name          = "${local.name}-jobs-dlq-not-empty"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.jobs_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "errors" {
  for_each            = { api = aws_lambda_function.api.function_name, worker = aws_lambda_function.worker.function_name }
  alarm_name          = "${each.value}-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}

# ---------------------------------------------------------------- outputs

output "function_url" { value = aws_lambda_function_url.api.function_url }
output "cloudfront_domain" { value = aws_cloudfront_distribution.api.domain_name }
output "jobs_queue_url" { value = aws_sqs_queue.jobs.url }
output "acm_validation" {
  value = var.api_domain == "" ? [] : [
    for o in aws_acm_certificate.api[0].domain_validation_options : { name = o.resource_record_name, value = o.resource_record_value }
  ]
}
