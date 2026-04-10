import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_LABELS } from "../src/lib/constants";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create demo user
  const passwordHash = await bcrypt.hash("leadbox123", 12);
  const user = await prisma.user.upsert({
    where: { email: "admin@leadbox.io" },
    update: {},
    create: {
      email: "admin@leadbox.io",
      name: "Admin",
      passwordHash,
    },
  });

  console.log("Created user:", user.email);

  // Create workspace
  const workspace = await prisma.workspace.upsert({
    where: { slug: "main-workspace" },
    update: {},
    create: {
      name: "Main Workspace",
      slug: "main-workspace",
    },
  });

  console.log("Created workspace:", workspace.name);

  // Add user as owner
  await prisma.workspaceMember.upsert({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      workspaceId: workspace.id,
      role: "OWNER",
    },
  });

  // Seed labels
  for (const label of DEFAULT_LABELS) {
    await prisma.label.upsert({
      where: {
        workspaceId_name: {
          workspaceId: workspace.id,
          name: label.name,
        },
      },
      update: {},
      create: {
        workspaceId: workspace.id,
        name: label.name,
        color: label.color,
        isSystem: label.isSystem,
        sortOrder: label.sortOrder,
      },
    });
  }

  console.log("Created default labels");
  console.log("\nSeed complete! Login with:");
  console.log("  Email: admin@leadbox.io");
  console.log("  Password: leadbox123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
