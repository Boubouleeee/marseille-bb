import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "data/osm/vieux-port.osm.gz");
const outputPath = resolve(root, "public/maps/vieux-port.json");

export const OLD_PORT_BBOX = Object.freeze({
  west: 5.366,
  south: 43.2905,
  east: 5.382,
  north: 43.301,
});

export const OLD_PORT_ORIGIN = Object.freeze({ lon: 5.3728, lat: 43.2957 });
export const OLD_PORT_SPAWN_TARGET = Object.freeze([-456.1, 311.5]);

function decodeXml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function attributes(xml) {
  return Object.fromEntries(
    [...xml.matchAll(/([\w:.-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decodeXml(value)]),
  );
}

export function parseOsmXml(xml) {
  const nodes = new Map();
  for (const match of xml.matchAll(/<node\b([^>]*?)(?:\/>|>[\s\S]*?<\/node>)/g)) {
    const node = attributes(match[1]);
    if (node.id && node.lat && node.lon) {
      nodes.set(node.id, { lat: Number(node.lat), lon: Number(node.lon) });
    }
  }

  const ways = [];
  for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const refs = [...match[2].matchAll(/<nd\b([^>]*)\/>/g)]
      .map((node) => attributes(node[1]).ref)
      .filter(Boolean);
    const tags = Object.fromEntries(
      [...match[2].matchAll(/<tag\b([^>]*)\/>/g)].map((tag) => {
        const values = attributes(tag[1]);
        return [values.k, values.v];
      }),
    );
    ways.push({ id: attributes(match[1]).id, refs, tags });
  }
  const relations = [];
  for (const match of xml.matchAll(/<relation\b([^>]*)>([\s\S]*?)<\/relation>/g)) {
    const members = [...match[2].matchAll(/<member\b([^>]*)\/>/g)].map((member) => attributes(member[1]));
    const tags = Object.fromEntries(
      [...match[2].matchAll(/<tag\b([^>]*)\/>/g)].map((tag) => {
        const values = attributes(tag[1]);
        return [values.k, values.v];
      }),
    );
    relations.push({ id: attributes(match[1]).id, members, tags });
  }
  return { nodes, ways, relations };
}

function project({ lat, lon }, origin) {
  const metersPerDegree = 111320;
  return [
    (lon - origin.lon) * metersPerDegree * Math.cos((origin.lat * Math.PI) / 180),
    (lat - origin.lat) * metersPerDegree,
  ];
}

function clipPolygon(points, bounds) {
  let polygon = points.slice(0, -1);
  const edges = [
    { inside: ([x]) => x >= bounds.minX, cross: (a, b) => intersectX(a, b, bounds.minX) },
    { inside: ([x]) => x <= bounds.maxX, cross: (a, b) => intersectX(a, b, bounds.maxX) },
    { inside: ([, z]) => z >= bounds.minZ, cross: (a, b) => intersectZ(a, b, bounds.minZ) },
    { inside: ([, z]) => z <= bounds.maxZ, cross: (a, b) => intersectZ(a, b, bounds.maxZ) },
  ];
  for (const edge of edges) {
    const input = polygon;
    polygon = [];
    if (!input.length) break;
    let previous = input[input.length - 1];
    for (const current of input) {
      const currentInside = edge.inside(current);
      const previousInside = edge.inside(previous);
      if (currentInside) {
        if (!previousInside) polygon.push(edge.cross(previous, current));
        polygon.push(current);
      } else if (previousInside) {
        polygon.push(edge.cross(previous, current));
      }
      previous = current;
    }
  }
  return polygon.length >= 3 ? [...polygon, polygon[0]] : [];
}

function intersectX(a, b, x) {
  const ratio = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + (b[1] - a[1]) * ratio];
}

function intersectZ(a, b, z) {
  const ratio = (z - a[1]) / (b[1] - a[1]);
  return [a[0] + (b[0] - a[0]) * ratio, z];
}

function clipSegment(a, b, bounds) {
  let start = 0;
  let end = 1;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const checks = [
    [-dx, a[0] - bounds.minX],
    [dx, bounds.maxX - a[0]],
    [-dz, a[1] - bounds.minZ],
    [dz, bounds.maxZ - a[1]],
  ];
  for (const [p, q] of checks) {
    if (p === 0 && q < 0) return null;
    if (p !== 0) {
      const ratio = q / p;
      if (p < 0) start = Math.max(start, ratio);
      else end = Math.min(end, ratio);
      if (start > end) return null;
    }
  }
  return [
    [a[0] + start * dx, a[1] + start * dz],
    [a[0] + end * dx, a[1] + end * dz],
  ];
}

function clipLine(points, bounds) {
  const lines = [];
  let current = [];
  for (let index = 1; index < points.length; index++) {
    const segment = clipSegment(points[index - 1], points[index], bounds);
    if (!segment) {
      if (current.length > 1) lines.push(current);
      current = [];
      continue;
    }
    if (!current.length || distance(current.at(-1), segment[0]) > 0.1) {
      if (current.length > 1) lines.push(current);
      current = [segment[0]];
    }
    current.push(segment[1]);
  }
  if (current.length > 1) lines.push(current);
  return lines;
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function simplify(points, tolerance = 1.2) {
  if (points.length <= 2) return points;
  let farthest = 0;
  let farthestDistance = 0;
  const first = points[0];
  const last = points.at(-1);
  for (let index = 1; index < points.length - 1; index++) {
    const point = points[index];
    const dx = last[0] - first[0];
    const dz = last[1] - first[1];
    const lengthSq = dx * dx + dz * dz;
    const ratio = lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((point[0] - first[0]) * dx + (point[1] - first[1]) * dz) / lengthSq));
    const gap = distance(point, [first[0] + ratio * dx, first[1] + ratio * dz]);
    if (gap > farthestDistance) {
      farthest = index;
      farthestDistance = gap;
    }
  }
  if (farthestDistance <= tolerance) return [first, last];
  return [
    ...simplify(points.slice(0, farthest + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(farthest), tolerance),
  ];
}

function roundedPoints(points) {
  return points.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
}

function polygonArea(points) {
  let area = 0;
  for (let index = 1; index < points.length; index++) {
    area += points[index - 1][0] * points[index][1] - points[index][0] * points[index - 1][1];
  }
  return Math.abs(area / 2);
}

function buildingHeight(tags) {
  const height = Number.parseFloat(tags.height);
  if (Number.isFinite(height) && height > 0) return Math.max(3, Math.min(55, height));
  const levels = Number.parseFloat(tags["building:levels"]);
  if (Number.isFinite(levels) && levels > 0) return Math.max(3, Math.min(55, levels * 3.1));
  return tags.building === "church" || tags.building === "cathedral" ? 17 : 10;
}

function roadWidth(kind) {
  if (["motorway", "trunk", "primary"].includes(kind)) return 11;
  if (kind === "secondary") return 8;
  if (["tertiary", "unclassified"].includes(kind)) return 6;
  if (["footway", "path", "pedestrian", "steps", "cycleway"].includes(kind)) return 2.4;
  return 4.5;
}

function pointOnSegment(point, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSq = dx * dx + dz * dz;
  const ratio = lengthSq === 0
    ? 0
    : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSq));
  return [a[0] + ratio * dx, a[1] + ratio * dz];
}

function nearestOnRoad(point, roads) {
  let nearest = null;
  for (const road of roads) {
    for (const line of road.lines) {
      for (let index = 1; index < line.length; index++) {
        const candidate = pointOnSegment(point, line[index - 1], line[index]);
        const gap = distance(point, candidate);
        if (!nearest || gap < nearest.distance) nearest = { point: candidate, distance: gap, street: road.name };
      }
    }
  }
  return nearest;
}

export function buildMap(osmXml, {
  bbox = OLD_PORT_BBOX,
  origin = OLD_PORT_ORIGIN,
  spawnTarget = OLD_PORT_SPAWN_TARGET,
} = {}) {
  const { nodes, ways, relations } = parseOsmXml(osmXml);
  const projectedBounds = [
    project({ lat: bbox.south, lon: bbox.west }, origin),
    project({ lat: bbox.north, lon: bbox.east }, origin),
  ];
  const bounds = {
    minX: projectedBounds[0][0],
    minZ: projectedBounds[0][1],
    maxX: projectedBounds[1][0],
    maxZ: projectedBounds[1][1],
  };
  const roads = [];
  const buildings = [];
  const waters = [];
  const wayById = new Map(ways.map((way) => [way.id, way]));
  let closedBuildingWays = 0;

  for (const way of ways) {
    const points = way.refs.map((ref) => nodes.get(ref)).filter(Boolean).map((node) => project(node, origin));
    if (points.length < 2) continue;

    if (way.tags.highway) {
      const lines = clipLine(points, bounds)
        .map((line) => simplify(line, 2.2))
        .filter((line) => line.length > 1)
        .map(roundedPoints);
      if (lines.length) {
        roads.push({
          id: way.id,
          name: way.tags["name:fr"] || way.tags.name || "",
          kind: way.tags.highway,
          width: roadWidth(way.tags.highway),
          lines,
        });
      }
    }

    const isBuilding = way.tags.building && way.refs[0] === way.refs.at(-1);
    if (isBuilding) closedBuildingWays++;
    const isWater = (way.tags.natural === "water" || way.tags.water || way.tags.waterway === "riverbank")
      && way.refs[0] === way.refs.at(-1);
    if (isBuilding || isWater) {
      const polygon = clipPolygon(points, bounds);
      const simplified = simplify(polygon, isBuilding ? 0.8 : 1.5);
      if (simplified.length < 4 || polygonArea(simplified) < (isBuilding ? 6 : 25)) continue;
      const feature = {
        id: way.id,
        points: roundedPoints(simplified),
      };
      if (isWater) waters.push(feature);
      else buildings.push({
        ...feature,
        height: buildingHeight(way.tags),
        kind: way.tags.building,
        levels: Number.parseInt(way.tags["building:levels"] || "", 10) || null,
      });
    }
  }

  for (const relation of relations) {
    const isWater = (relation.tags.natural === "water" || relation.tags.water)
      && relation.tags.type === "multipolygon";
    if (!isWater) continue;
    const pieces = relation.members
      .filter((member) => member.type === "way" && member.role === "outer")
      .map((member) => wayById.get(member.ref)?.refs)
      .filter((refs) => refs?.length > 1);
    if (!pieces.length) continue;
    const ring = pieces.shift();
    while (pieces.length && ring[0] !== ring.at(-1)) {
      const end = ring.at(-1);
      const start = ring[0];
      const nextIndex = pieces.findIndex((refs) => refs[0] === end || refs.at(-1) === end || refs[0] === start || refs.at(-1) === start);
      if (nextIndex < 0) break;
      const next = pieces.splice(nextIndex, 1)[0];
      if (next[0] === end) ring.push(...next.slice(1));
      else if (next.at(-1) === end) ring.push(...next.slice(0, -1).reverse());
      else if (next.at(-1) === start) ring.unshift(...next.slice(0, -1));
      else ring.unshift(...next.slice(1).reverse());
    }
    if (ring[0] !== ring.at(-1) || ring.length < 4) continue;
    const polygon = clipPolygon(ring.map((ref) => nodes.get(ref)).filter(Boolean).map((node) => project(node, origin)), bounds);
    if (polygon.length < 4 || polygonArea(polygon) < 25) continue;
    waters.push({ id: relation.id, points: roundedPoints(simplify(polygon, 1.5)) });
  }

  if (!roads.length || !buildings.length) {
    throw new Error(`L'extrait OSM est incomplet (routes: ${roads.length}, empreintes: ${buildings.length}, batiments fermes: ${closedBuildingWays}).`);
  }
  const spawn = nearestOnRoad(spawnTarget, roads);
  if (!spawn) throw new Error("Aucune route OSM ne permet de placer le point de depart.");

  return {
    schemaVersion: 1,
    attribution: "© OpenStreetMap contributors",
    license: "ODbL-1.0",
    source: "https://www.openstreetmap.org/",
    bbox,
    origin,
    bounds,
    spawn: { x: Math.round(spawn.point[0] * 10) / 10, z: Math.round(spawn.point[1] * 10) / 10, street: spawn.street },
    roads,
    buildings,
    waters,
    counts: { roads: roads.length, buildings: buildings.length, waters: waters.length },
  };
}

async function updateExtract() {
  const box = OLD_PORT_BBOX;
  const bbox = `${box.west},${box.south},${box.east},${box.north}`;
  const response = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`, {
    headers: { "User-Agent": "MarseilleBB/0.1 OSM map builder" },
  });
  if (!response.ok) throw new Error(`OpenStreetMap a repondu ${response.status} lors du telechargement.`);
  const xml = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, gzipSync(xml, { level: 9 }));
}

async function main() {
  if (process.argv.includes("--update")) await updateExtract();
  const compressed = await readFile(sourcePath);
  const xml = gunzipSync(compressed).toString("utf8");
  const map = buildMap(xml);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(map)}\n`);
  console.log(`Generated Vieux-Port map: ${map.counts.roads} roads, ${map.counts.buildings} buildings, ${map.counts.waters} water polygons.`);
  console.log(`Spawn: ${map.spawn.street || "unnamed street"} (${map.spawn.x.toFixed(1)} m, ${map.spawn.z.toFixed(1)} m)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
