# MongoDB Atlas Staging Setup

## 1. Create a Separate Staging Database / Cluster

1. In MongoDB Atlas, create a dedicated **Staging** cluster (e.g., `vyaparbot-staging`, M0 Free tier or M10) or a completely separate Atlas Project from Production.
2. Never share a database, cluster user, or `MONGODB_URI` between Staging and Production.
3. Name the staging database explicitly in the connection string (e.g., `vyaparbot_staging`).

## 2. Replica Set & Transaction Support

- MongoDB Atlas clusters (including M0 Free tier) run as **3-node replica sets** by default, which satisfies `src/utils/db-transaction.js`'s requirement for ACID multi-document transactions in `NODE_ENV=production`.
- Standalone MongoDB instances will fail financial and inventory mutations in `NODE_ENV=production` by design.

## 3. Connection String Format

```text
mongodb+srv://<staging_db_user>:<url_encoded_password>@<staging-cluster>.mongodb.net/vyaparbot_staging?retryWrites=true&w=majority
```

- `retryWrites=true&w=majority` is recommended for safe transaction retries and write durability.

## 4. Database User Permissions

- Create a dedicated Atlas Database User (e.g., `vyaparbot_staging_app`) with a strong random password.
- Assign **Built-in Role**: `readWrite` scoped **only** to `vyaparbot_staging` (or `readWriteAnyDatabase` only if needed; prefer least-privilege `readWrite@vyaparbot_staging`).
- Do **not** grant `atlasAdmin` or `dbAdminAnyDatabase` to the application user.

## 5. Network Access

- Render Free Web Services use dynamic outbound IPs (static outbound IPs are not included on Render Free).
- In Atlas **Network Access**, add Render's published outbound IP ranges if available for your region, or allow `0.0.0.0/0` **only** for Staging alongside a strong, rotated database password and isolated staging-only data.
- For AWS Production later, restrict Atlas Network Access strictly to the AWS VPC NAT Gateway / PrivateLink / Peering CIDR.
