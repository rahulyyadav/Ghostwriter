# Deployment Guide

This guide covers deploying the Post Suggestion Bot to various platforms.

## Prerequisites

Before deploying:
- Complete setup in [README.md](README.md)
- Test locally with `npm run dev`
- Verify all environment variables are set
- Confirm Supabase tables are created

## Platform-Specific Guides

### Railway (Recommended)

**Why Railway:**
- Automatic deployments from Git
- Free tier available
- Easy environment variable management
- Good for Node.js apps

**Steps:**

1. **Install Railway CLI**
   ```bash
   npm install -g @railway/cli
   ```

2. **Login**
   ```bash
   railway login
   ```

3. **Create New Project**
   ```bash
   railway init
   ```

4. **Add Environment Variables**
   ```bash
   railway variables set SLACK_BOT_TOKEN="xoxb-..."
   railway variables set SLACK_APP_TOKEN="xapp-..."
   railway variables set SUPABASE_URL="https://..."
   railway variables set SUPABASE_SERVICE_ROLE_KEY="..."
   railway variables set GEMINI_API_KEY="..."
   railway variables set FOUNDER_USER_IDS="U123,U456"
   railway variables set OPTED_IN_CHANNELS="C123,C456"
   railway variables set SLACK_WORKSPACE_ID="T123"
   ```

5. **Deploy**
   ```bash
   railway up
   ```

6. **View Logs**
   ```bash
   railway logs
   ```

7. **Open Dashboard**
   ```bash
   railway open
   ```

**Auto-Deploy from GitHub:**
1. Push code to GitHub
2. Connect Railway to your repository
3. Every push to `main` will auto-deploy

---

### Render

**Why Render:**
- Free tier with generous limits
- Automatic HTTPS
- Simple dashboard

**Steps:**

1. **Push Code to GitHub/GitLab**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **Create New Web Service**
   - Go to [render.com/dashboard](https://render.com/dashboard)
   - Click "New +" → "Web Service"
   - Connect your repository

3. **Configure Service**
   - **Name**: `post-suggestion-bot`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

4. **Add Environment Variables**
   In the dashboard, add all variables from `.env`:
   - `SLACK_BOT_TOKEN`
   - `SLACK_APP_TOKEN`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GEMINI_API_KEY`
   - `FOUNDER_USER_IDS`
   - `OPTED_IN_CHANNELS`
   - `SLACK_WORKSPACE_ID`
   - `LOG_LEVEL=info`

5. **Deploy**
   - Click "Create Web Service"
   - Render will automatically deploy

6. **View Logs**
   - Go to Logs tab in dashboard

---

### Fly.io

**Why Fly.io:**
- Global edge deployment
- Good free tier
- Fast scaling

**Steps:**

1. **Install Flyctl**
   ```bash
   # macOS
   brew install flyctl

   # Windows
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"

   # Linux
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login**
   ```bash
   fly auth login
   ```

3. **Launch App**
   ```bash
   fly launch
   ```

   This creates a `fly.toml` file. Update it:
   ```toml
   app = "post-suggestion-bot"
   primary_region = "sjc"

   [build]
     builder = "heroku/buildpacks:20"

   [[services]]
     internal_port = 3000
     protocol = "tcp"

     [[services.ports]]
       port = 80
       handlers = ["http"]

     [[services.ports]]
       port = 443
       handlers = ["tls", "http"]
   ```

4. **Set Secrets**
   ```bash
   fly secrets set SLACK_BOT_TOKEN="xoxb-..."
   fly secrets set SLACK_APP_TOKEN="xapp-..."
   fly secrets set SUPABASE_URL="https://..."
   fly secrets set SUPABASE_SERVICE_ROLE_KEY="..."
   fly secrets set GEMINI_API_KEY="..."
   fly secrets set FOUNDER_USER_IDS="U123,U456"
   fly secrets set OPTED_IN_CHANNELS="C123,C456"
   fly secrets set SLACK_WORKSPACE_ID="T123"
   ```

5. **Deploy**
   ```bash
   fly deploy
   ```

6. **View Logs**
   ```bash
   fly logs
   ```

7. **Scale** (if needed)
   ```bash
   fly scale count 1  # Number of instances
   ```

---

### AWS EC2

**Why EC2:**
- Full control over server
- AWS free tier available

**Steps:**

1. **Launch EC2 Instance**
   - AMI: Ubuntu 22.04 LTS
   - Instance Type: t2.micro (free tier)
   - Security Group: Allow SSH (port 22)

2. **SSH into Instance**
   ```bash
   ssh -i your-key.pem ubuntu@your-instance-ip
   ```

3. **Install Node.js**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node --version  # Verify installation
   ```

4. **Install PM2 (Process Manager)**
   ```bash
   sudo npm install -g pm2
   ```

5. **Clone Repository**
   ```bash
   git clone <your-repo-url>
   cd postSuggestionBot-Slack
   npm install
   ```

6. **Create .env File**
   ```bash
   nano .env
   # Paste your environment variables
   # Save with Ctrl+X, then Y
   ```

7. **Start Bot with PM2**
   ```bash
   pm2 start index.js --name post-bot
   pm2 save
   pm2 startup  # Follow instructions to auto-start on reboot
   ```

8. **View Logs**
   ```bash
   pm2 logs post-bot
   ```

9. **Monitor**
   ```bash
   pm2 status
   pm2 monit
   ```

---

## Post-Deployment Checklist

After deploying to any platform:

- [ ] Bot shows as "Active" in Slack Apps
- [ ] Check logs for `✅ Bot is running!` message
- [ ] Verify database connection: Look for `Supabase connection established`
- [ ] Send test message in opted-in channel
- [ ] Confirm message appears in logs
- [ ] Wait for conversation to meet signal gate thresholds
- [ ] Verify notification DM is received

## Monitoring

### Health Checks

Bot logs health reports every hour. Look for:
```json
{
  "healthy": true,
  "components": {
    "database": { "healthy": true },
    "gemini": { "healthy": true }
  }
}
```

### Key Metrics to Watch

- **messages.processed**: Should increase as conversations happen
- **llm.calls**: LLM usage (stay under free tier limits)
- **notifications.sent**: Founder notifications delivered
- **errors.total**: Should be low/zero

### Alerts to Set Up

If deploying to production, consider setting up alerts for:
- High error rate (> 10 errors/hour)
- No messages processed for > 1 hour (bot may be down)
- Rate limit hits (need to upgrade Gemini tier)

## Scaling Considerations

### When to Scale

- **Handling 10+ active channels**: Increase memory/CPU
- **500+ messages/day**: Consider Gemini paid tier
- **Multiple workspaces**: Deploy separate instances per workspace

### Cost Estimates

**Free Tier (< 10 channels, < 100 messages/day):**
- Railway/Render/Fly.io: Free
- Supabase: Free (500MB DB)
- Gemini: Free (1M tokens/day)
- **Total: $0/month**

**Small Team (10-20 channels, 1000 messages/day):**
- Hosting: $5-10/month
- Supabase: Free
- Gemini: Free (or $20/month for Pro)
- **Total: $5-30/month**

## Troubleshooting Deployment

### Bot Crashes on Startup

1. Check logs for error message
2. Verify all required environment variables are set
3. Test database connection manually:
   ```bash
   node -e "require('./src/database/supabaseClient').testConnection()"
   ```

### Socket Mode Connection Fails

- Ensure `SLACK_APP_TOKEN` is correct (should start with `xapp-`)
- Verify Socket Mode is enabled in Slack app settings
- Check firewall allows outbound connections

### Out of Memory Errors

- Increase memory allocation in platform settings
- Check for memory leaks in logs
- Consider scaling to larger instance

### Database Connection Timeouts

- Verify Supabase project is not paused (free tier auto-pauses after inactivity)
- Check `SUPABASE_URL` is correct
- Ensure service role key has read/write permissions

## Rollback

If deployment has issues:

**Railway/Render:**
- Go to dashboard → Deployments
- Click "Rollback" on previous working version

**Fly.io:**
```bash
fly releases  # See recent releases
fly releases rollback <version>
```

**EC2:**
```bash
git checkout <previous-commit>
pm2 restart post-bot
```

## Backup Strategy

### Database Backups

Supabase provides automatic backups on paid plans. For free tier:
```sql
-- Manual backup: export to CSV
COPY conversations TO '/path/conversations.csv' CSV HEADER;
COPY insights TO '/path/insights.csv' CSV HEADER;
```

### Configuration Backups

- Store `.env.example` in Git (never commit actual `.env`)
- Document all environment variables
- Keep Slack tokens in secure password manager

## Security Best Practices

1. **Never commit `.env` file** - Added to `.gitignore`
2. **Use service role key carefully** - Never expose in logs
3. **Rotate tokens regularly** - Every 6 months
4. **Monitor logs for suspicious activity**
5. **Keep dependencies updated**: `npm audit fix`

## Support

If you encounter deployment issues:
1. Check logs first
2. Review troubleshooting section
3. Open an issue in repository with:
   - Platform you're deploying to
   - Error logs (redact sensitive info)
   - Steps you've tried
