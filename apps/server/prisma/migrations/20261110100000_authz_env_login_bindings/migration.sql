-- Env-listed logins (admins, allowed logins) bound to the GitHub account id that first used them.
CREATE TYPE "EnvLoginKind" AS ENUM ('ADMIN', 'ALLOWED');

CREATE TABLE "EnvLoginBinding" (
    "kind" "EnvLoginKind" NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "githubUserId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvLoginBinding_pkey" PRIMARY KEY ("kind","githubLogin")
);

CREATE INDEX "EnvLoginBinding_githubUserId_idx" ON "EnvLoginBinding"("githubUserId");

-- Access grants are also looked up by GitHub account id (a decision follows a renamed account).
CREATE INDEX "AccessGrant_githubUserId_idx" ON "AccessGrant"("githubUserId");
