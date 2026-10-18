# FaultLine — AWS Production Deployment Guide

This guide details the complete production deployment architecture, security model, and operational runbook for **FaultLine** on AWS EC2.

---

## 1. Architecture Overview

```
GitHub Push / Dispatch (main branch)
               │
               ▼
   [GitHub Actions CI Gate]
   ├── Python 3.11 Test Suite (pytest tests/ -v)
   ├── Node.js 20 Frontend Build (npm run build)
   └── Docker Image Build Verification
               │ (Only if all pass)
               ▼
    [GitHub Actions Deploy Job]
               │
               ├── 1. OIDC Token Exchange (sts:AssumeRoleWithWebIdentity)
               │      Assumes: FaultLineDeployRole
               │
               ├── 2. Sync Secret to AWS SSM Parameter Store
               │      Writes: /faultline/GROQ_API_KEY (SecureString)
               │
               └── 3. Dispatch SSM Run Command (AWS-RunShellScript)
                      Target: EC2 Instance i-04aeb4651eb8eb860
                                   │
                                   ▼
                    [AWS Systems Manager Agent]
                                   │
                                   ▼
                   [/opt/faultline/scripts/deploy-ec2.sh]
                   ├── Fetch intended commit via Git
                   ├── Read /faultline/GROQ_API_KEY from SSM
                   ├── Write 0600 .env (Never logged)
                   ├── docker compose build && docker compose up -d
                   ├── Poll http://localhost:8000/health
                   └── Prune dangling images
                                   │
                                   ▼
                    [Public Health Verification]
                    curl http://18.212.225.64:8000/health
```

### Core Security & Architecture Pillars
1. **Zero SSH Access:** No SSH keys (`.pem` / `id_rsa`) are created, required, or stored in GitHub Secrets. SSH port 22 is completely closed on the internet.
2. **Keyless Authentication (OIDC):** GitHub Actions assumes an IAM role via OpenID Connect (OIDC) with temporary, short-lived security tokens. No long-lived AWS Access Keys (`AKIA...`) are stored in GitHub.
3. **AWS Systems Manager Transport:** All remote execution happens through AWS Systems Manager (SSM) Run Command using the installed `amazon-ssm-agent`.
4. **Zero-Leak Secret Delivery:** Secrets (`GROQ_API_KEY`) are stored in AWS Systems Manager Parameter Store as `SecureString` and pulled directly on the EC2 host with restricted permissions (`0600`). Secrets are never passed as command-line arguments or logged in CloudTrail / GitHub Actions logs.
5. **Database Network Isolation:** FalkorDB does not publish ports `6379` or `3000` to the EC2 host network interface. It is accessible exclusively to the FastAPI container over the internal Docker Compose bridge network.
6. **Data Persistence:** FalkorDB graph data is preserved across deployments using a named Docker volume (`falkordb_data`).

---

## 2. Infrastructure Inventory

| Resource | Value | Notes |
|:---|:---|:---|
| **Region** | `us-east-1` | N. Virginia |
| **EC2 Instance Name** | `FaultLine-server` | Single instance architecture |
| **Instance ID** | `i-04aeb4651eb8eb860` | Registered in AWS Systems Manager |
| **Public IPv4** | `18.212.225.64` | Dedicated host IP |
| **Instance Type** | `t3.small` | 2 vCPU, 2.0 GiB RAM |
| **OS** | Ubuntu 24.04 LTS | Kernel 6.8+, Docker + Compose installed |
| **Storage** | 30 GiB gp3 EBS | Root filesystem |
| **EC2 Instance Role** | `FaultLineEC2SSMRole` | Attached to instance |
| **Target App Directory**| `/opt/faultline` | Standard system application directory |

---

## 3. One-Time AWS IAM & OIDC Setup

Follow these exact steps in your AWS Console or AWS CLI.

### Step 3.1: Create GitHub OIDC Identity Provider (If Not Already Present)
*Check if `token.actions.githubusercontent.com` already exists under IAM -> Identity Providers.*

If creating via AWS CLI:
```bash
aws iam create-open-id-connect-provider \
  --url "https://token.actions.githubusercontent.com" \
  --client-id-list "sts.amazonaws.com" \
  --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" "1c5824a8527fc201765f05240e3da35478b040e1"
```

### Step 3.2: Create the GitHub Deployment Role (`FaultLineDeployRole`)

1. **Trust Relationship Policy (`trust-policy.json`):**
Replace `123456789012` with your actual 12-digit AWS Account ID:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:ankit-cybertron/FaultLine:*"
        }
      }
    }
  ]
}
```

Create the role:
```bash
aws iam create-role \
  --role-name FaultLineDeployRole \
  --assume-role-policy-document file://trust-policy.json
```

2. **Least-Privilege Deployment Policy (`deploy-policy.json`):**
Replace `123456789012` with your AWS Account ID:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSSMRunCommandOnSpecificInstance",
      "Effect": "Allow",
      "Action": [
        "ssm:SendCommand"
      ],
      "Resource": [
        "arn:aws:ec2:us-east-1:123456789012:instance/i-04aeb4651eb8eb860",
        "arn:aws:ssm:us-east-1:*:document/AWS-RunShellScript"
      ]
    },
    {
      "Sid": "AllowSSMInvocationPolling",
      "Effect": "Allow",
      "Action": [
        "ssm:GetCommandInvocation",
        "ssm:ListCommandInvocations"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowParameterStoreSync",
      "Effect": "Allow",
      "Action": [
        "ssm:PutParameter",
        "ssm:GetParameter"
      ],
      "Resource": "arn:aws:ssm:us-east-1:123456789012:parameter/faultline/*"
    }
  ]
}
```

Attach the policy to the deployment role:
```bash
aws iam put-role-policy \
  --role-name FaultLineDeployRole \
  --policy-name FaultLineDeploymentPermissions \
  --policy-document file://deploy-policy.json
```

### Step 3.3: Configure the EC2 Role (`FaultLineEC2SSMRole`)

The EC2 instance role already has `AmazonSSMManagedInstanceCore`. It also requires read permission for Parameter Store to read `/faultline/GROQ_API_KEY`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowParameterStoreRead",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter"
      ],
      "Resource": "arn:aws:ssm:us-east-1:123456789012:parameter/faultline/*"
    }
  ]
}
```

Attach via AWS CLI:
```bash
aws iam put-role-policy \
  --role-name FaultLineEC2SSMRole \
  --policy-name FaultLineSSMParameterRead \
  --policy-document file://ec2-param-policy.json
```

#### Note on AWS KMS Encryption
- **Default (AWS-Managed Key):** SSM Parameter Store defaults to the AWS-managed key `alias/aws/ssm`. When using `alias/aws/ssm`, IAM permissions for KMS are handled automatically by AWS without requiring extra `kms:*` statements.
- **Customer-Managed Key (CMK):** If you configure a custom KMS key (`arn:aws:kms:us-east-1:123456789012:key/your-key-id`), you must also grant:
  - `kms:Decrypt` and `kms:GenerateDataKey` to `FaultLineDeployRole`.
  - `kms:Decrypt` to `FaultLineEC2SSMRole`.

---

## 4. GitHub Repository Configuration

In GitHub -> **Settings** -> **Secrets and variables** -> **Actions**:

### Repository Secrets
| Secret Name | Description | Example |
|:---|:---|:---|
| `AWS_DEPLOY_ROLE_ARN` | The ARN of the deployment role created in Step 3.2 | `arn:aws:iam::123456789012:role/FaultLineDeployRole` |
| `GROQ_API_KEY` | Your Groq API key (starts with `gsk_...`) | `gsk_...` |

### Repository Variables
| Variable Name | Description | Default / Value |
|:---|:---|:---|
| `AWS_REGION` | AWS Deployment Region | `us-east-1` |
| `EC2_INSTANCE_ID` | Target EC2 Instance ID | `i-04aeb4651eb8eb860` |
| `EC2_PUBLIC_IP` | EC2 Public IP for health checks | `18.212.225.64` |

---

## 5. Network & Security Group Configuration

In AWS EC2 -> **Security Groups** -> select the security group attached to `FaultLine-server`:

### Inbound Rules
| Port Range | Protocol | Source | Description |
|:---|:---|:---|:---|
| `8000` | TCP | `0.0.0.0/0` (or restricted corporate CIDR) | FaultLine FastAPI Web App & API (HTTP) |
| *None* | *None* | *None* | **Do NOT open port 22 (SSH).** All terminal access occurs via AWS SSM Session Manager. |
| *None* | *None* | *None* | **Do NOT open ports 6379 or 3000.** FalkorDB is strictly container-internal. |

> [!NOTE]  
> Port 8000 provides direct HTTP access. In enterprise production, a reverse proxy (e.g., Caddy or Cloudflare Tunnel) can terminate TLS/HTTPS on port 443 without requiring an expensive AWS Application Load Balancer.

### Outbound Rules
| Port Range | Protocol | Destination | Description |
|:---|:---|:---|:---|
| `All` | All | `0.0.0.0/0` | Required for SSM agent communication, downloading packages, and calling the Groq API. |

---

## 6. One-Time EC2 Host Preparation

Via AWS Systems Manager Session Manager (or Run Command), verify:

1. **Docker service is active and permissions are set:**
   ```bash
   sudo systemctl enable docker
   sudo systemctl start docker
   sudo usermod -aG docker ubuntu
   ```

2. **Add 2 GB Swap Space (Crucial for `t3.small` 2 GB RAM):**
   ```bash
   # Check if swap exists
   swapon --show
   
   # If no swap exists, create a 2 GB swapfile:
   sudo fallocate -l 2G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
   *Why this matters:* Compiling Node.js/Vite assets and building Docker images can temporarily spike RAM usage to ~1.4 GB. Having a swapfile prevents any out-of-memory kernel kills (`OOMKilled`).

---

## 7. Deployment Procedures

### 7.1 Automatic Deployment
Every `git push` to the `main` branch automatically triggers the pipeline:
1. `ci-gate` job executes unit tests, builds frontend, and validates Dockerfile.
2. If tests pass, `deploy` job assumes `FaultLineDeployRole` via OIDC.
3. Syncs `GROQ_API_KEY` to AWS Systems Manager Parameter Store.
4. Triggers SSM Run Command on `i-04aeb4651eb8eb860`.
5. Verifies public HTTP endpoint `http://18.212.225.64:8000/health`.

### 7.2 Manual Deployment via GitHub Actions
1. Navigate to **Actions** -> **Deploy to AWS EC2**.
2. Click **Run workflow** -> Select `main` branch -> **Run workflow**.

### 7.3 Manual Deployment via AWS Systems Manager
If GitHub Actions is ever unreachable, trigger deployment directly from AWS CLI:
```bash
aws ssm send-command \
  --instance-ids "i-04aeb4651eb8eb860" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=[
    "cd /opt/faultline && git pull origin main && bash scripts/deploy-ec2.sh"
  ]' \
  --region "us-east-1"
```

---

## 8. Verification & Health Monitoring

To verify that the application is live:

```bash
# 1. Healthcheck probe
curl -s http://18.212.225.64:8000/health | jq .

# Expected output:
# {
#   "status": "ok",
#   "version": "0.2.0",
#   "falkordb": "connected",
#   "groq": "configured",
#   "graphs": ["demo_agent", "fleet", "trail", "whowhen"]
# }

# 2. Access Web UI in browser
http://18.212.225.64:8000
```

---

## 9. Rollback Procedure

If a deployed commit causes an issue in production:

1. Identify the last known good commit SHA (e.g., `git log -n 5 --oneline`).
2. Run an SSM command specifying the previous commit SHA:
   ```bash
   aws ssm send-command \
     --instance-ids "i-04aeb4651eb8eb860" \
     --document-name "AWS-RunShellScript" \
     --parameters 'commands=[
       "/bin/bash /opt/faultline/scripts/deploy-ec2.sh <PREVIOUS_COMMIT_SHA>"
     ]' \
     --region "us-east-1"
   ```
3. Or revert the commit in Git and push to `main`:
   ```bash
   git revert HEAD
   git push origin main
   ```

---

## 10. Operational Troubleshooting

| Symptom | Root Cause | Fix |
|:---|:---|:---|
| SSM Command Status shows `Failed` | Git conflict or missing dependency on host | Inspect `StandardErrorContent` from SSM or run `docker compose logs api` via Session Manager. |
| `/health` returns `"falkordb": "disconnected"` | FalkorDB container still initializing or crashed | Check `docker compose ps` and `docker compose logs falkordb`. Verify `falkordb_data` volume permissions. |
| `/health` returns `"groq": "missing_key"` | `GROQ_API_KEY` not found in SSM Parameter Store or `.env` | Ensure secret is configured in GitHub Secrets (`GROQ_API_KEY`) or run `aws ssm put-parameter --name "/faultline/GROQ_API_KEY" --value "gsk_..." --type "SecureString" --overwrite`. |
| Port 8000 unreachable from browser | EC2 Security Group inbound rule missing | In AWS Console, verify Security Group inbound rule allows TCP port 8000. |
| Out of memory during Docker build | `t3.small` RAM exhaustion during `npm build` | Ensure the 2 GB swapfile is configured as described in Section 6. |
