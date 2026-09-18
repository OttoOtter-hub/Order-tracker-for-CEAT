import "reflect-metadata";
import * as bcrypt from "bcryptjs";
import { AppDataSource } from "../data-source";
import { User } from "../users/user.entity";
import { Role } from "../common/enums/role.enum";

/**
 * Admin-only CLI for creating login accounts. There is no public
 * registration endpoint on purpose (see README) — usage:
 *
 *   npm run seed:user -- --email=ops@ceat.com --password=... --role=ops
 *   npm run seed:user -- --email=buyer@mtkrosberg.com --password=... --role=client --customerId=<customer-uuid>
 */
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) {
      out[match[1]] = match[2];
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email || !args.password || !args.role) {
    console.error(
      "Usage: npm run seed:user -- --email=<email> --password=<password> --role=ops|client [--customerId=<uuid>]",
    );
    process.exitCode = 1;
    return;
  }
  if (args.role !== Role.OPS && args.role !== Role.CLIENT) {
    console.error(`Invalid role "${args.role}", expected "ops" or "client"`);
    process.exitCode = 1;
    return;
  }
  if (args.role === Role.CLIENT && !args.customerId) {
    console.error("--customerId is required when --role=client");
    process.exitCode = 1;
    return;
  }

  await AppDataSource.initialize();
  try {
    const userRepo = AppDataSource.getRepository(User);
    const existing = await userRepo.findOne({ where: { email: args.email } });
    if (existing) {
      console.error(`User ${args.email} already exists`);
      process.exitCode = 1;
      return;
    }

    const passwordHash = await bcrypt.hash(args.password, 10);
    const user = userRepo.create({
      email: args.email,
      passwordHash,
      role: args.role as Role,
      customer: args.customerId ? { id: args.customerId } : null,
    });
    await userRepo.save(user);
    console.log(`Created ${args.role} user ${args.email} (id: ${user.id})`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
