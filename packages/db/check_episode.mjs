import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const episode = await prisma.episode.findUnique({ where: { id: "cmss48m7a001bhbw4mmattynt" } });
console.log("episode:", JSON.stringify(episode));
const season = await prisma.season.findUnique({ where: { id: "cmss48bvo0019hbw4tjcszbue" } });
console.log("season:", JSON.stringify(season));
await prisma.$disconnect();
