// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "AIController.h"
#include "HLPresenceController.generated.h"

class AHLPresenceActor;

/**
 * Brain for the presence. It does the spatial reasoning that makes the scare work:
 * find a navigable spot that sits just outside the player's central vision (down a
 * hall, in a doorway) with line of sight, place the presence there, and then each
 * frame check two retreat conditions — the player turned to look straight at it, or
 * the player came too close. Either one makes it vanish. No pathfinding-to-attack,
 * no damage: it only ever appears and withdraws.
 */
UCLASS()
class HOLLOWBLOCK_API AHLPresenceController : public AAIController
{
	GENERATED_BODY()

public:
	AHLPresenceController();

	virtual void Tick(float DeltaTime) override;

	/** Attempt to position the owning presence at the edge of the player's view. */
	UFUNCTION(BlueprintCallable, Category = "Presence")
	bool TryPlaceAtEdgeOfView(float Tension);

protected:
	/** The presence retreats if the angle between the player's view and it falls below this (degrees). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Presence", meta = (ClampMin = "0.0"))
	float DirectLookAngle = 12.f;

	/** The presence retreats if the player gets closer than this (cm). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Presence", meta = (ClampMin = "0.0"))
	float RetreatDistance = 350.f;

	/** Preferred distance from the player to place the presence (cm). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Presence", meta = (ClampMin = "0.0"))
	float PlacementDistance = 1400.f;

	/** Horizontal angle off the player's view direction to place at (degrees). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Presence", meta = (ClampMin = "0.0"))
	float PlacementOffsetAngle = 35.f;

private:
	AHLPresenceActor* GetPresence() const;
	bool IsPlayerLookingAt(const FVector& Location, const class APawn* PlayerPawn) const;
};
