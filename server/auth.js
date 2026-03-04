const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const GitHubStrategy = require("passport-github2").Strategy;
const AzureStrategy = require("passport-azure-ad-oauth2");

function configurePassport({ upsertOAuthUser, findUserById }) {
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    try {
      const user = findUserById(id);
      done(null, user || false);
    } catch (err) {
      done(err);
    }
  });

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google/callback",
        },
        async (_, __, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value || `google:${profile.id}`;
            const user = upsertOAuthUser("google", profile.id, email);
            done(null, user);
          } catch (err) {
            done(err);
          }
        }
      )
    );
  }

  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
          callbackURL: process.env.GITHUB_CALLBACK_URL || "http://localhost:3000/auth/github/callback",
        },
        async (_, __, profile, done) => {
          try {
            const username = profile.username || `github:${profile.id}`;
            const user = upsertOAuthUser("github", profile.id, `github:${username}`);
            done(null, user);
          } catch (err) {
            done(err);
          }
        }
      )
    );
  }

  if (process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET) {
    passport.use(
      "azure",
      new AzureStrategy(
        {
          clientID: process.env.AZURE_CLIENT_ID,
          clientSecret: process.env.AZURE_CLIENT_SECRET,
          callbackURL: process.env.AZURE_CALLBACK_URL || "http://localhost:3000/auth/azure/callback",
          resource: "https://graph.microsoft.com",
          tenant: process.env.AZURE_TENANT || "common",
        },
        async (_, __, params, _profile, done) => {
          try {
            const oid = params?.id_token || `azure-${Date.now()}`;
            const username = `azure:${oid.slice(0, 16)}`;
            const user = upsertOAuthUser("azure", oid, username);
            done(null, user);
          } catch (err) {
            done(err);
          }
        }
      )
    );
  }
}

module.exports = { configurePassport, passport };
