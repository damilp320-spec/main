# Hollow Block

A first-person **psychological ambient horror** for **Unreal Engine 5** (5.3+).

You wake in an abandoned vertical slum — a dense, stacked block of apartments. The
machines are still running: televisions hiss behind closed doors, fans turn, fridges
hum, pipes knock somewhere above you. But there are no people. The horror is that
**absence** — a place built for thousands of lives, still warm with their appliances,
and utterly empty. Something moves at the edge of the corridors when you stop paying
attention. You never get a clear look at it. You just need to find a way out.

Inspired by the claustrophobic mood of *Welcome to Kowloon*, with its own quieter,
device-haunted atmosphere. **No combat** — survival is about light, composure, and
not looking too long at what's watching you.

---

## What's in this repository

This is a **code-first project**. It contains the complete C++ gameplay framework,
project files, and configuration. It does **not** contain binary assets (meshes,
textures, sounds, maps, Blueprints) — those are authored inside the Unreal Editor,
which can't run in the environment this was generated in. Everything here is built so
that a designer finishes the game in-editor without writing more C++: every system is
exposed to Blueprint via `UPROPERTY` / `UFUNCTION` and `BlueprintImplementableEvent`
hooks.

```
HollowBlock/
├── HollowBlock.uproject          Project descriptor (UE 5.3, EnhancedInput)
├── Config/                       Engine/Game/Input defaults
├── Content/                      (empty — author maps, BPs, assets here in-editor)
└── Source/HollowBlock/
    ├── Player/        HLCharacter, HLPlayerController
    ├── Core/          HLGameMode, HLHUD, HLTensionDirector
    ├── Components/    HLFlashlight, HLComposure, HLObjective
    ├── Atmosphere/    HLAmbientEmitter, HLAmbienceManager, HLFlickerLight
    ├── Interaction/   HLInteractableInterface, HLPickupItem, HLDoor, HLNoteItem
    └── AI/            HLPresenceActor, HLPresenceController
```

---

## Systems overview

| System | Class | What it does |
|---|---|---|
| Player pawn | `AHLCharacter` | FP movement (walk/crouch/sprint+stamina), look, flashlight, key inventory, interaction line-trace |
| Input | `AHLPlayerController` | Locks input to game; mapping context added by the pawn |
| Flashlight | `UHLFlashlightComponent` | Battery drain/recharge, toggle, low-battery + forced flicker |
| Composure (sanity) | `UHLComposureComponent` | Frays in darkness / near the presence, recovers when safe; no death — broadcasts a "break" event for a non-lethal scare |
| Objectives | `UHLObjectiveComponent` | Ordered objective list with tag-based completion; lives on the GameMode |
| Ambient emitter | `UHLAmbientEmitterComponent` | The signature system: per-room device beds + randomized one-shots, **no human voices** |
| Ambience manager | `UHLAmbienceManager` | World subsystem; fans a global intensity out to every emitter |
| Flicker lights | `UHLFlickerLightComponent` | Fluorescent / faulty / dying flicker styles + forced blackout |
| Dread director | `UHLTensionDirector` | World subsystem: rising tension lowers ambience and opens presence windows |
| The presence | `AHLPresenceActor` + `AHLPresenceController` | Materializes at the edge of view, watches, and vanishes the moment you look straight at it or get close. Never attacks. |
| Interaction | `IHLInteractableInterface` | Doors, pickups, notes all implement this; the pawn calls it on the focused actor |

How it fits together: the **TensionDirector** drifts tension upward over time and on
beats (reading a note, scripted scares). As tension rises it tells the
**AmbienceManager** to thin the soundscape — the block gets *quieter but wronger* —
and opens **presence** windows. The presence appears in your peripheral vision and
retreats if you face it. Standing in the dark drains **composure**, which other
systems read to push heartbeat/vignette. The **flashlight** keeps composure up but
drains its battery and can give you away with its flicker.

---

## Setup & build

You need Unreal Engine 5.3 or newer and a C++ toolchain (Visual Studio 2022 on
Windows, or Xcode on macOS).

1. **Generate project files**: right-click `HollowBlock.uproject` →
   *Generate Visual Studio project files* (Windows), or run from a terminal:
   ```
   "<UE>/Engine/Build/BatchFiles/Build.bat" HollowBlockEditor Win64 Development -project="<path>/HollowBlock.uproject"
   ```
2. **Build**: open the generated `.sln` and build the `HollowBlock` target, or let
   the editor compile on first launch.
3. **Open** `HollowBlock.uproject`. The editor will offer to rebuild the module if
   needed — accept.

> The `EngineAssociation` in the `.uproject` is set to `5.3`. If you use a different
> 5.x version, right-click the `.uproject` → *Switch Unreal Engine version*.

---

## Finishing the game in-editor

The C++ gives you working logic; you supply the content. Recommended steps:

### 1. Blueprint children
Create Blueprint subclasses so you can assign assets without touching C++:
- **`BP_HLCharacter`** (parent `HLCharacter`): create an `InputMappingContext` and
  six `InputAction`s (Move = Axis2D, Look = Axis2D, Sprint = Digital, Crouch =
  Digital, Interact = Digital, Flashlight = Digital). Assign them to the matching
  fields under *HollowBlock | Input*. Add a first-person mesh/arms if desired.
- **`BP_HLPresence`** (parent `HLPresenceActor`): assign a skeletal mesh whose
  material exposes a scalar `Opacity` parameter (used for the fade). Add VFX in the
  `OnStateChanged` event.
- **`BP_HLDoor`** (parent `HLDoor`): add a timeline on `OnSwing` to rotate the
  `Hinge`, and a locked-rattle sound on `OnRattleLocked`.
- **`BP_HLPickup` / `BP_HLNote`**: assign meshes; for notes, fill `Title`/`Body`.

### 2. Set the GameMode to use your Blueprints
In *Project Settings → Maps & Modes* (or a `BP_HLGameMode`), set the default pawn to
`BP_HLCharacter` and the HUD to your UMG-driven HUD.

### 3. HUD widget
Create a UMG widget and bind it to `AHLHUD`'s pure functions:
`GetBatteryPercent`, `GetComposurePercent`, `GetObjectiveText`,
`GetCurrentInteractionPrompt`. Add it to the viewport from a `BP_HLHUD` child.

### 4. Build a level
Block out corridors and apartments. Then:
- Drop **`UHLAmbientEmitterComponent`** on props/room markers; assign a `LoopingBed`
  (fan/fridge/TV hiss) and a few `OneShots` (pipe knock, kettle, washer). **Do not
  add voices** — that's the rule that sells the emptiness.
- Add **`UHLFlickerLightComponent`** to ceiling lights; pick a style.
- Place a **`BP_HLPresence`** in the level and register it with the director (e.g. in
  Level Blueprint `BeginPlay`: get the `HLTensionDirector` world subsystem → `SetPresence`).
- Place doors, key pickups, batteries, and notes. Wire a key `ItemTag` to a door's
  `RequiredKeyTag`. Advance objectives from door `OnDoorOpened` / pickup events.
- Bake a NavMesh (the presence projects placement onto it).

### 5. Lighting & post
Keep it dark — lean on the flashlight and flicker. Drive a post-process vignette /
desaturation from `UHLComposureComponent::OnComposureChanged` and music stings from
`UHLTensionDirector::OnTensionChanged`.

---

## Controls (default mapping you'll author)

| Action | Suggested key |
|---|---|
| Move | W A S D |
| Look | Mouse |
| Sprint | Left Shift (hold) |
| Crouch | Left Ctrl (toggle) |
| Interact | E |
| Flashlight | F |

---

## Design pillars

1. **Lived-in, but empty.** Machines run, no one answers. Every sound implies a
   person who isn't there.
2. **You are never sure.** The presence is glimpsed, never confronted. Looking
   directly makes it gone — so you doubt you saw it.
3. **Light is safety and liability.** The flashlight steadies you but drains, flickers,
   and announces you.
4. **No fail state, only dread.** Composure breaking disorients rather than kills,
   keeping you in the world.

---

## Status

Gameplay framework complete and self-consistent in C++. Content (maps, assets,
Blueprints, sound) is authored in-editor per the steps above. This project could not
be compiled in its generation environment (no UE5 toolchain present); build it locally
following *Setup & build*.
