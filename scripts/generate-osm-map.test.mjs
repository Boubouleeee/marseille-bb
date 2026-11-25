import assert from "node:assert/strict";
import test from "node:test";
import { buildMap, parseOsmXml } from "./generate-osm-map.mjs";

const fixture = `<?xml version="1.0"?>
<osm>
  <node id="1" lat="43.2957" lon="5.3728"/>
  <node id="2" lat="43.2957" lon="5.3730"/>
  <node id="3" lat="43.2959" lon="5.3730"/>
  <node id="4" lat="43.2959" lon="5.3728"/>
  <node id="6" lat="43.2957" lon="5.3750"/>
  <node id="7" lat="43.2962" lon="5.3728"/>
  <way id="10">
    <nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/>
    <tag k="building" v="apartments"/><tag k="building:levels" v="4"/>
  </way>
  <way id="11">
    <nd ref="1"/><nd ref="6"/>
    <tag k="highway" v="residential"/><tag k="name" v="Rue de l&apos;Exemple"/>
  </way>
  <way id="12"><nd ref="1"/><nd ref="2"/><nd ref="7"/><nd ref="1"/></way>
  <relation id="20">
    <member type="way" ref="12" role="outer"/>
    <tag k="type" v="multipolygon"/><tag k="natural" v="water"/><tag k="water" v="harbour"/>
  </relation>
</osm>`;

test("parses OSM way tags, node references and XML entities", () => {
  const parsed = parseOsmXml(fixture);
  assert.equal(parsed.nodes.size, 6);
  assert.equal(parsed.ways[0].tags.building, "apartments");
  assert.equal(parsed.ways[1].tags.name, "Rue de l'Exemple");
  assert.equal(parsed.relations[0].members[0].ref, "12");
  assert.deepEqual(parsed.ways[0].refs, ["1", "2", "3", "4", "1"]);
});

test("converts geographic features to metre-scale roads and building footprints", () => {
  const map = buildMap(fixture);
  assert.equal(map.counts.roads, 1);
  assert.equal(map.counts.buildings, 1);
  assert.equal(map.counts.waters, 1);
  assert.equal(map.spawn.street, "Rue de l'Exemple");
  assert.equal(map.buildings[0].height, 12.4);
  const [first, second] = map.roads[0].lines[0];
  assert.ok(Math.abs(second[0] - first[0]) > 100);
  assert.ok(map.buildings[0].points.length >= 4);
  assert.equal(map.license, "ODbL-1.0");
});
