// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "HLTensionDirector.generated.h"

class UHLAmbienceManager;
class AHLPresenceActor;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnTensionChanged, float, Tension);

/**
 * The "dread AI". A world subsystem that holds a 0..1 tension value and shapes the
 * experience around it: it lowers ambience intensity as tension rises (the block
 * goes wrong-quiet), opens windows where the presence is allowed to appear, and
 * broadcasts OnTensionChanged for post-process / music Blueprints to react.
 *
 * Tension rises slowly over time and in response to gameplay (AddTension on a scare
 * or objective beat) and bleeds back down when the player is calm and safe. This
 * keeps pacing from flat-lining without scripting every beat by hand.
 */
UCLASS()
class HOLLOWBLOCK_API UHLTensionDirector : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	static UHLTensionDirector* Get(const UObject* WorldContext);

	// UTickableWorldSubsystem
	virtual void OnWorldBeginPlay(UWorld& InWorld) override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;

	/** Nudge tension up (e.g. a scare fired, the presence was seen). */
	UFUNCTION(BlueprintCallable, Category = "Tension")
	void AddTension(float Amount);

	/** Register the level's presence actor so the director can show/hide it. */
	UFUNCTION(BlueprintCallable, Category = "Tension")
	void SetPresence(AHLPresenceActor* InPresence) { Presence = InPresence; }

	UFUNCTION(BlueprintPure, Category = "Tension")
	float GetTension() const { return Tension; }

	UPROPERTY(BlueprintAssignable, Category = "Tension")
	FOnTensionChanged OnTensionChanged;

protected:
	/** Baseline tension gained per second simply by existing in the block. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Tension", meta = (ClampMin = "0.0"))
	float PassiveRisePerSecond = 0.004f;

	/** How fast tension decays back toward baseline when no events occur. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Tension", meta = (ClampMin = "0.0"))
	float DecayPerSecond = 0.01f;

	/** Tension above which the presence is permitted to appear. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Tension", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float PresenceThreshold = 0.55f;

private:
	void UpdateAmbience();
	void UpdatePresenceWindow(float DeltaTime);

	float Tension = 0.f;
	float LastBroadcastTension = -1.f;
	float PresenceCooldown = 0.f;

	UPROPERTY(Transient)
	TWeakObjectPtr<AHLPresenceActor> Presence;

	UPROPERTY(Transient)
	TWeakObjectPtr<UHLAmbienceManager> CachedAmbience;
};
