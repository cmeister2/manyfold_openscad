/* [Dimensions] */
// Overall width in millimetres
width = 100; // [10:5:200]
// Overall depth in millimetres
depth = 80; // [10:5:200]
// Overall height in millimetres
height = 40; // [10:5:100]

/* [Appearance] */
// Add a lid
lid = false;
// Surface finish
finish = "smooth"; // [smooth:Smooth,rough:Rough]
// Label text
label = "A \"quoted\" box";
// Position in millimetres
offset = [0, 0, 0]; // [-10:1:10]
// Wall thickness
wall = 2; // [1:Thin,2:Standard,3:Thick]

/* [Hidden] */
internal = 8;

translate(offset) {
  difference() {
    cube([width, depth, height]);
    translate([wall, wall, wall])
      cube([width - 2 * wall, depth - 2 * wall, height]);
  }

  if (lid)
    translate([0, 0, height])
      cube([width, depth, wall]);
}
