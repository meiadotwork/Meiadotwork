import json, collections

terms = []
def add(tid, label, facet, parents=None, syns=None, level=None):
    terms.append({"id": tid, "label": label, "facet": facet,
                  "level": level, "parents": parents or [], "synonyms": syns or []})

# ============ SUBJECT: group -> kind -> specific ============
GROUPS = [
 ("animals", "Animals", ["animal", "fauna", "creature real"], [
   ("birds", "Birds", ["bird", "avian"], [
     ("swallow",["barn swallow"]),("sparrow",[]),("crow",[]),("raven",[]),("owl",[]),
     ("eagle",[]),("hawk",["falcon"]),("hummingbird",[]),("swan",[]),("dove",["pigeon"]),
     ("peacock",[]),("vulture",[]),("rooster",["cockerel"]),("crane-bird",["heron","stork"]),
     ("feather",["plume","quill"]),
   ]),
   ("mammals", "Mammals", ["mammal"], [
     ("wolf",["wolves"]),("fox",[]),("dog",["hound","puppy"]),("cat",["kitten"]),
     ("bear",[]),("horse",["stallion","mare","pony"]),("deer",["doe","fawn"]),
     ("stag",["elk","antlers","buck"]),("rabbit",["hare","bunny"]),("mouse",["rat","rodent"]),
     ("bat",["bats"]),("ram",["goat","sheep"]),("bull",["ox","cow","buffalo"]),
     ("elephant",[]),("boar",["pig","hog"]),("hedgehog",[]),("squirrel",[]),
     ("monkey",["ape","gorilla"]),("whale",["orca"]),("dolphin",[]),
   ]),
   ("big-cats", "Big cats", ["big cat","wildcat","feline"], [
     ("panther",[]),("tiger",[]),("lion",[]),("leopard",["jaguar","cheetah"]),
   ]),
   ("insects", "Insects & spiders", ["insect","bug","arachnid"], [
     ("moth",["luna moth"]),("butterfly",["butterflies"]),("bee",["honeybee","bumblebee","wasp"]),
     ("beetle",["scarab"]),("dragonfly",[]),("spider",["tarantula"]),("scorpion",[]),
     ("cicada",["locust"]),("snail",["slug"]),("mantis",["praying mantis"]),
     ("ant",[]),("ladybug",["ladybird"]),("web",["spiderweb","cobweb"]),
   ]),
   ("sea-life", "Sea life", ["sea creature","marine","aquatic"], [
     ("fish",[]),("koi",["carp"]),("shark",[]),("octopus",[]),("jellyfish",[]),
     ("crab",[]),("seahorse",[]),("shell",["seashell","conch"]),("eel",[]),
     ("lobster",["crayfish"]),("starfish",["sea star"]),("squid",[]),
   ]),
   ("reptiles", "Reptiles & amphibians", ["reptile","amphibian"], [
     ("snake",["serpent","cobra","viper","python"]),("lizard",["gecko","chameleon"]),
     ("turtle",["tortoise"]),("frog",["toad"]),("crocodile",["alligator"]),
     ("dinosaur",["t rex","stegosaurus","raptor","triceratops"]),
   ]),
 ]),

 ("plants", "Plants", ["plant","flora","botanical subject"], [
   ("flowers", "Flowers", ["flower","bloom","blossom","floral"], [
     ("rose",["roses"]),("peony",[]),("lily",["lilies"]),("sunflower",[]),("daisy",["daisies"]),
     ("poppy",["poppies"]),("chrysanthemum",["mum flower"]),("lotus",["water lily"]),
     ("orchid",[]),("tulip",[]),("cherry-blossom",["sakura"]),("carnation",[]),
     ("magnolia",[]),("hibiscus",[]),("marigold",[]),("forget-me-not",[]),
     ("lavender",[]),("thistle",[]),("dandelion",[]),("iris",[]),("violet",["pansy"]),
   ]),
   ("foliage", "Foliage", ["leaves","greenery","leafage"], [
     ("leaf",[]),("branch",["twig","bough"]),("fern",[]),("ivy",[]),("vine",["vines","creeper"]),
     ("moss",[]),("wheat",["barley","grain"]),("clover",["shamrock"]),("grass",[]),
     ("root",["roots"]),
     ("cannabis",["weed","marijuana","pot leaf","hemp","cannabis leaf"]),
   ]),
   ("trees", "Trees", ["tree"], [
     ("oak",[]),("willow",[]),("pine",["cypress"]),("palm",["palm tree"]),
     ("bamboo",[]),("cactus",["succulent"]),("olive-branch",["olive"]),
   ]),
   ("fruit-seeds", "Fruit & seeds", ["fruit","seed"], [
     ("cherry",["cherries"]),("pomegranate",[]),("grapes",[]),("berry",["berries"]),
     ("seed-pod",["pod","seedhead"]),("pinecone",["pine cone"]),("lemon",[]),
     ("apple",[]),("strawberry",[]),
   ]),
   ("fungi", "Fungi", ["fungus","mycology"], [
     ("mushroom",["toadstool"]),
   ]),
 ]),

 ("people", "People", ["person","human","figure subject"], [
   ("figures", "Figures", ["figure","character"], [
     ("lady-head",["woman","girl head","female head"]),("portrait",["face","head"]),
     ("hooded-figure",["hood","cloak","monk","cultist","hooded"]),("nude",["figure study"]),("warrior",["knight","samurai","soldier"]),
     ("sailor",["pirate"]),("jester",["clown","harlequin"]),("witch",["sorceress"]),
     ("cowboy",["cowgirl","western figure"]),("statue",["bust","sculpture"]),
     ("child",["baby"]),("dancer",[]),
   ]),
   ("body-parts", "Body parts", ["body part","anatomy"], [
     ("hand",["hands","fingers"]),("praying-hands",["prayer hands"]),("handshake",["shaking hands","holding hands","clasped hands"]),
     ("eye",["eyes","eyeball"]),("heart",["hearts"]),
     ("anatomical-heart",["real heart"]),("lips",["mouth","kiss"]),
     ("teeth",["tooth","jaw"]),("brain",[]),("lungs",[]),("ear",[]),
     ("spine",["vertebrae","backbone"]),("ribcage",["ribs"]),("foot-subject",["feet"]),
     ("blood",["blood drop","droplet","drip"]),("tear",["tears","teardrop","crying"]),
     ("leg",["legs","thigh","knee"]),("arm",["forearm","elbow"]),
     # Wings belong to cherubs and winged figures as often as to birds, so they
     # sit here rather than under Animals, where they would drag every angel
     # into a search for animals.
     ("wing",["wings"]),
   ]),
   ("bones", "Bones", ["bone","skeletal"], [
     ("skull",["skulls","cranium","death head"]),("skeleton",[]),("bone-single",["single bone"]),
   ]),
   ("religious-figures", "Religious figures", ["religious figure","deity"], [
     ("angel",["seraph"]),("cherub",[]),("saint",[]),("madonna",["virgin mary"]),
     ("devil",["satan","imp"]),("demon",[]),("reaper",["grim reaper","death figure"]),
     ("christ",["jesus","crucified figure"]),
   ]),
 ]),

 ("creatures", "Creatures", ["mythical","fantasy","legendary"], [
   ("mythical-beasts", "Mythical beasts", ["mythical beast","monster"], [
     ("dragon",[]),("phoenix",["firebird"]),("griffin",["gryphon"]),("hydra",[]),
     ("unicorn",[]),("sphinx",[]),("chimera",[]),("centaur",[]),
   ]),
   ("water-beings", "Water beings", ["water being"], [
     ("mermaid",["siren"]),("kraken",[]),
   ]),
   ("spirits", "Spirits", ["spirit","apparition"], [
     ("ghost",["phantom"]),("shadow-figure",["shade"]),
   ]),
 ]),

 ("objects", "Objects", ["object","item","thing"], [
   ("weapons", "Weapons", ["weapon","arms"], [
     ("dagger",["knife","blade","stiletto"]),("sword",["sabre","katana","rapier"]),
     ("axe",["hatchet"]),("arrow",["arrows"]),("bow",["longbow","archery"]),
     ("spear",["lance","trident"]),("scythe",["sickle"]),("gun",["pistol","revolver","rifle"]),
     ("shield",[]),("guillotine",[]),
   ]),
   ("vessels", "Vessels", ["vessel","container"], [
     ("chalice",["goblet","grail"]),("cup",[]),("teacup",["tea cup","mug"]),
     ("bottle",["flask","vial","potion"]),("tin-can",["can","tin"]),
     ("molotov",["molotov cocktail","petrol bomb"]),
     ("bin",["trash can","trash","rubbish bin","waste basket"]),("vase",[]),("urn",[]),("jar",[]),
   ]),
   ("light-fire", "Light & fire", ["light source"], [
     ("candle",["candles","candlestick"]),("lantern",[]),("lamp",["oil lamp"]),
     ("matchstick",["match","matches"]),("lighter",["zippo"]),
     ("cigarette",["cigarettes","joint","smoking"]),
   ]),
   ("timepieces", "Timepieces", ["timepiece","time"], [
     ("clock",[]),("pocket-watch",["watch"]),("hourglass",["sandglass","egg timer"]),("sundial",[]),
   ]),
   ("tools", "Tools & hardware", ["tool","hardware"], [
     ("scissors",["shears"]),("hammer",[]),("needle",["pin","syringe"]),
     ("key",["keys"]),("lock",["padlock"]),("chain",["chains","links"]),
     ("hook",["fishhook"]),("anchor",[]),("compass",["compass rose"]),
     ("rope",["cord"]),("noose",["gallows","hangman"]),("barbed-wire",["barbwire","razor wire"]),
     ("handcuffs",["shackles","cuffs"]),("telescope",["spyglass"]),("cage",["birdcage"]),("mirror",[]),
     ("screw",["screws"]),("nail",["nails"]),("saw",["handsaw"]),
     ("wrench",["spanner"]),("pliers",[]),
   ]),
   ("dress-jewellery", "Dress & jewellery", ["dress","jewellery","jewelry","adornment"], [
     ("ring",["wedding ring"]),("necklace",["pendant","locket"]),("earring",["earrings","hoops"]),("crown",["tiara","diadem"]),
     ("mask",["masks"]),("balaclava",["ski mask"]),("hat",["cap","top hat"]),("shoe",["boot","heels","shoes"]),
     ("glove",["gloves"]),("gown",["corset"]),("pearl",["pearls"]),
     ("gem",["jewel","diamond"]),("ribbon",["bow ribbon"]),
   ]),
   ("music", "Music", ["musical","instrument"], [
     ("guitar",[]),("violin",["cello","fiddle"]),("piano",[]),("record",["vinyl"]),
   ]),
   ("vehicles", "Vehicles", ["vehicle","transport"], [
     ("ship",["sailboat","galleon","tall ship","boat"]),("lighthouse",[]),
     ("plane",["aeroplane","airplane","biplane"]),("car",["automobile"]),
     ("motorcycle",["motorbike","chopper"]),("bicycle",["bike"]),
     ("hot-air-balloon",["balloon"]),("rocket",["spaceship"]),("train",["locomotive"]),
   ]),
   ("cards-games", "Cards & games", ["card","game"], [
     ("playing-card",["cards","ace","joker"]),("tarot-card",["tarot"]),
     ("dice",["die"]),("chess-piece",["chess","pawn"]),
   ]),
   ("buildings", "Buildings", ["building","architecture","structure"], [
     ("church",["cathedral","chapel","basilica","temple","mosque","shrine"]),
     ("house",["home","cottage"]),("castle",["fortress","palace"]),
     ("tower",["spire"]),("bridge",[]),("door",["doorway","gate"]),
     ("ruins",["ruin"]),("stairs",["staircase","steps"]),
     ("tombstone",["grave","gravestone","headstone"]),("coffin",["casket"]),
   ]),
   ("furniture", "Furniture", ["furnishing"], [
     ("chair",["stool","throne"]),("table",["desk"]),("bed",[]),
     ("bathtub",["bath","tub"]),("clock-tower",["grandfather clock"]),
   ]),
   ("food-drink", "Food & drink", ["food","drink","meal"], [
     ("cake",["pastry"]),("bread",["loaf"]),("coffee",["espresso","coffee cup"]),
     ("wine",["wine glass","goblet of wine"]),("honey",["honeycomb"]),
   ]),
   ("paper-books", "Paper & books", ["paper","stationery"], [
     ("book",["books","tome","grimoire"]),("letter",["envelope","love letter"]),
     ("scroll",["parchment"]),("banner",["ribbon banner"]),
     ("banknote",["money","cash","dollar","dollar bill","bill"]),
   ]),
 ]),

 ("landscape", "Landscape", ["scenery","scene","nature scene"], [
   ("terrain", "Terrain", ["land","ground"], [
     ("mountain",["mountains","peak"]),("volcano",[]),("forest",["woods"]),
     ("desert",["dunes"]),("cave",["grotto"]),("island",[]),
     ("stone",["rock","boulder"]),("crystal",["quartz","geode"]),("field",["meadow"]),
   ]),
   ("water-features", "Water", ["water","aquatic scene"], [
     ("wave",["waves","great wave"]),("ocean",["sea"]),("river",["stream"]),
     ("waterfall",[]),("ripples",[]),
   ]),
   ("sky-celestial", "Sky & celestial", ["sky","celestial","space","cosmos"], [
     ("moon",["crescent moon","full moon","lunar","moon phases"]),("sun",["solar","sunburst","sunrise","sunset"]),
     ("star",["stars","starburst"]),("comet",["shooting star","meteor"]),
     ("planet",["saturn","jupiter"]),("constellation",["star map"]),
     ("galaxy",["nebula"]),("eclipse",[]),("cloud",["clouds"]),("rainbow",[]),
   ]),
   ("weather-elements", "Weather & elements", ["weather","element"], [
     ("lightning",["thunderbolt","bolt"]),("rain",["raindrop"]),("snow",["snowflake"]),
     ("wind",[]),("flame",["fire","blaze","flames"]),("smoke",[]),
     ("explosion",["mushroom cloud","blast","nuke","atomic"]),
   ]),
 ]),

 ("symbols", "Symbols", ["symbol","sign","icon"], [
   ("religious-symbols", "Religious", ["religious symbol","sacred symbol"], [
     ("cross",["crucifix"]),("rosary",["prayer beads"]),("halo",["nimbus"]),
     ("sacred-heart",["flaming heart"]),("ankh",[]),
   ]),
   ("occult", "Occult", ["esoteric","mystical","witchy","magic"], [
     ("pentagram",["pentacle"]),("ouroboros",["snake eating tail"]),
     ("all-seeing-eye",["eye of providence"]),("sigil",[]),("rune",["runes","norse"]),
     ("alchemical",["alchemy"]),("moth-skull",["death's head"]),
   ]),
   ("zodiac", "Zodiac", ["astrology","star sign","horoscope"], [
     ("zodiac-sign",["sun sign"]),("birth-chart",["astrology chart","natal chart"]),
   ]),
   ("protective", "Protective", ["talisman","amulet","charm"], [
     ("evil-eye",["nazar"]),("hamsa",["hand of fatima"]),("horseshoe",[]),("dreamcatcher",[]),
   ]),
   ("geometric-symbols", "Geometric", ["geometry","geometric symbol"], [
     ("sacred-geometry",["flower of life","metatron"]),("triangle",[]),("circle",[]),
     ("spiral",["swirl"]),("triskelion",["triskele","triple spiral"]),("infinity",["infinity symbol"]),("celtic-knot",["knotwork","celtic"]),
     ("yin-yang",["taijitu"]),
     ("hexagon",["hexagonal"]),("pentagon",[]),("cube",["cubes"]),("sphere",["orb"]),
   ]),
 ]),

 ("ornament", "Ornament", ["ornamental","decorative"], [
   ("mandala", "Mandala", ["mandalas"], []),
   ("filigree", "Filigree", ["scrollwork","flourish"], []),
   ("lace", "Lace", ["lacework","doily"], []),
   ("frames-borders", "Frames & borders", ["frame","border","cartouche"], [
     ("arch",["gothic arch","archway"]),("window",["stained glass","rose window"]),
     ("column",["pillar"]),("chandelier",[]),
   ]),
   ("pattern", "Pattern", ["patterns","motif"], [
     ("repeat-pattern",["tiling"]),("dot-pattern",["dots"]),("line-pattern",["hatching","lines"]),
     ("abstract-shape",["abstract","squiggle","blob","brushstroke"]),
   ]),
 ]),

 ("lettering", "Lettering", ["text","writing","type"], [
   ("script", "Script", ["cursive","handwriting"], []),
   ("blackletter", "Blackletter", ["gothic lettering","old english","fraktur"], []),
   ("numerals", "Numerals", ["number","numbers"], [
     ("roman-numeral",["roman numerals"]),("date",["dates"]),
   ]),
   ("words", "Words", ["wording"], [
     ("quote",["phrase","saying"]),("name",["names"]),("monogram",["initial","initials"]),
   ]),
 ]),
]

for gid, glabel, gsyn, kinds in GROUPS:
    add(gid, glabel, "subject", [], gsyn, level=1)
    for kid, klabel, ksyn, leaves in kinds:
        add(kid, klabel, "subject", [gid], ksyn, level=2)
        for lid, lsyn in leaves:
            add(lid, lid.replace("-", " ").capitalize(), "subject", [kid], lsyn, level=3)

# ============ TECHNIQUE (read from folder names) ============
for tid, label, syns in [
    ("line-work","Line work",["linework","line","outline style","clean line"]),
    ("dot-work","Dot work",["dotwork","stippling","stipple","pointillism"]),
    ("dot-by-dot","Dot by dot",["dotbydot","dot to dot"]),
    ("minimal","Minimal",["minimalist","simple","understated"]),
    ("solid","Solid black",["solid fill","blackout","filled black"]),
    ("inverted","Inverted",["negative space","reverse","white on black"]),
    ("three-d","3D",["3d","dimensional","depth"]),
    ("mandala-technique","Mandala work",["mandala style"]),
    ("outline-technique","Outline",["outline only","line drawing"]),
    ("stencil","Stencil",["stencils","transfer"]),
]:
    add(tid, label, "technique", [], syns)

# ============ FORM (read from folder names) ============
add("freeform","Freeform","form",[],["free form","stylised","stylized","interpretive"])
add("real-form","Real form","form",[],["realform","realistic","true to life","lifelike"])

# ============ COLOUR ============
for tid,label,syns in [
    ("black-and-grey","Black & grey",["black and gray","greyscale","grayscale","black & grey"]),
    ("solid-black-colour","Solid black",["all black","pure black"]),
    ("full-colour","Colour",["full color","color","colourful","multicolour"]),
    ("red-accent","Red accent",["spot red","red highlight"]),
    ("limited-palette","Limited palette",["two tone","duotone","muted palette"]),
]:
    add(tid,label,"colour",[],syns)

# ============ PLACEMENT ============
for tid,label,syns in [
    ("forearm","Forearm",["lower arm","inner arm"]),("upper-arm","Upper arm",["bicep","tricep"]),
    ("sleeve","Sleeve",["full sleeve","half sleeve"]),("shoulder","Shoulder",["deltoid"]),
    ("hand-placement","Hand",["knuckles"]),("finger-placement","Finger",["digit"]),
    ("wrist","Wrist",["inner wrist"]),("neck-placement","Neck",["throat","nape","behind ear"]),
    ("chest","Chest",["pec","chest piece"]),("sternum","Sternum",["underboob","centre chest"]),
    ("ribs-placement","Ribs",["rib cage","side body"]),("stomach","Stomach",["belly","abdomen"]),
    ("back","Back",["upper back","lower back","back piece"]),
    ("spine-placement","Spine",["along spine"]),("hip","Hip",["hips","pelvis"]),
    ("thigh","Thigh",["thighs","quad"]),("knee","Knee",["kneecap"]),
    ("calf","Calf",["shin","lower leg"]),("ankle","Ankle",["ankles"]),
    ("foot-placement","Foot",["toes"]),("head-placement","Head",["scalp"]),
]:
    add(tid,label,"placement",[],syns)

# ============ FORMAT & SCALE ============
for tid,label,syns in [
    ("micro","Micro",["tiny","mini","very small"]),("small","Small",["little"]),
    ("medium","Medium",["mid size"]),("large","Large",["big","statement"]),
    ("vertical","Vertical",["portrait orientation","tall"]),
    ("horizontal","Horizontal",["landscape orientation","wide"]),
    ("square-format","Square",["square canvas"]),
    ("circular","Circular",["round","circle format"]),
    ("symmetrical","Symmetrical",["symmetry","mirrored"]),
    ("filler","Filler",["gapfiller","gap filler"]),
    ("band","Band",["armband","bracelet","wrap around"]),
    ("pair","Pair",["matching","set"]),
]:
    add(tid,label,"format",[],syns)

# ============ MOOD ============
for tid,label,syns in [
    ("dark-mood","Dark",["moody","sombre","sinister"]),
    ("gothic","Gothic",["goth"]),
    ("occult-mood","Occult mood",["mystical mood","witchy mood"]),
    ("romantic","Romantic",["love","sentimental","tender"]),
    ("feminine","Feminine",["girly","pretty"]),
    ("masculine","Masculine",["rugged"]),
    ("nautical","Nautical",["sailor theme","maritime"]),
    ("botanical-mood","Botanical",["nature theme","garden"]),
    ("memento-mori","Memento mori",["mortality","vanitas"]),
    ("mythology","Mythology",["myth","legend","folklore"]),
    ("religious-mood","Religious",["spiritual","devotional","sacred"]),
    ("whimsical","Whimsical",["playful","quirky","fun"]),
    ("cute","Cute",["kawaii","sweet","adorable"]),
    ("elegant","Elegant",["refined","graceful"]),
    ("macabre","Macabre",["morbid","creepy","horror"]),
    ("vintage","Vintage",["antique","retro"]),
    ("celestial-mood","Celestial",["cosmic","astral"]),
    ("anatomical-mood","Anatomical",["medical","scientific"]),
    ("bold-mood","Bold",["striking","graphic","punchy"]),
    ("calm","Calm",["serene","quiet","peaceful"]),
]:
    add(tid,label,"mood",[],syns)

# ============ validate ============
ids=[t["id"] for t in terms]
dupes=[k for k,v in collections.Counter(ids).items() if v>1]
assert not dupes, f"duplicate ids: {dupes}"
idset=set(ids)
for t in terms:
    for p in t["parents"]:
        assert p in idset, f"{t['id']} -> unknown parent {p}"

def norm(s): 
    import re
    return re.sub(r"[^a-z0-9]+"," ",s.lower()).strip()

owner={}
collisions=[]
ids_by_facet={}
for t in terms:
    ids_by_facet.setdefault((t["facet"], norm(t["id"])), t["id"])
for t in terms:
    for s in [t["label"]]+t["synonyms"]:
        k=(t["facet"], norm(s))
        if k in ids_by_facet and ids_by_facet[k]!=t["id"]:
            collisions.append((s,t["id"],f"collides with term id {ids_by_facet[k]}"))
        elif k in owner and owner[k]!=t["id"]:
            collisions.append((s,t["id"],f"already used by {owner[k]}"))
        else:
            owner[k]=t["id"]
assert not collisions, "within-facet collisions:\n"+"\n".join(map(str,collisions))

doc={
 "version":2,"updated":"2026-08-19",
 "note":"Subject runs group -> kind -> specific; tag the most specific term and the "
        "levels above are implied. Technique and form are read from the Dropbox folder "
        "name, not inferred from the image.",
 "facets":[
   {"id":"subject","label":"Subject","multi":True,"required":True,"source":"model",
    "note":"What is depicted. Tag every distinct element, most specific term available."},
   {"id":"technique","label":"Technique","multi":True,"required":True,"source":"folder"},
   {"id":"form","label":"Form","multi":False,"required":False,"source":"folder"},
   {"id":"colour","label":"Colour","multi":False,"required":True,"source":"model"},
   {"id":"placement","label":"Placement","multi":True,"required":False,"source":"model"},
   {"id":"format","label":"Size & shape","multi":True,"required":False,"source":"model"},
   {"id":"mood","label":"Mood","multi":True,"required":False,"source":"model"},
 ],
 "terms":terms,
}
with open("/home/user/Meiadotwork/taxonomy/taxonomy.json","w") as f:
    json.dump(doc,f,indent=2,ensure_ascii=False); f.write("\n")

c=collections.Counter(t["facet"] for t in terms)
lv=collections.Counter(t["level"] for t in terms if t["facet"]=="subject")
print("terms:",len(terms))
for k,v in c.most_common(): print(f"  {k:11} {v}")
print("subject levels:", dict(lv))
print("synonyms:", sum(len(t['synonyms']) for t in terms))
