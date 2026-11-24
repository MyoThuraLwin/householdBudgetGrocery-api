import { db } from "./db.js";
import { exists, assert } from "./http.js";
export const unpack = (r: any) => ({
  ...JSON.parse(r.payload),
  id: r.id,
  revision: r.revision,
  createdAt: r.createdAt,
});
export async function save(kind: string, payload: unknown, tx: any = db) {
  return unpack(
    await tx.savedRecord.create({
      data: { kind, payload: JSON.stringify(payload) },
    }),
  );
}
export async function record(id: string, kind: string, tx: any = db) {
  const r: any = exists(await tx.savedRecord.findUnique({ where: { id } }));
  assert(r.kind === kind, "Record was not found.", 404);
  return unpack(r);
}
export async function replace(id: string, payload: any, tx: any = db) {
  const { id: _, revision: __, createdAt: ___, ...data } = payload;
  return unpack(
    await tx.savedRecord.update({
      where: { id },
      data: { payload: JSON.stringify(data), revision: { increment: 1 } },
    }),
  );
}
