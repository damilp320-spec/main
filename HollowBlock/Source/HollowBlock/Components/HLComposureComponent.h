// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "HLComposureComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnComposureChanged, float, ComposurePercent);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnComposureBroke);

/**
 * "Composure" is this game's sanity model. It frays while the player stands in
 * darkness or near the presence, and recovers in lit, quiet areas. Other systems
 * (post-process, audio, the TensionDirector) listen to OnComposureChanged to push
 * heartbeat audio, vignette, whispers, and breathing as composure falls.
 *
 * There is no death here: when composure bottoms out OnComposureBroke fires so a
 * Blueprint can stage a non-lethal scare / disorientation rather than a game over.
 */
UCLASS(ClassGroup = (HollowBlock), meta = (BlueprintSpawnableComponent))
class HOLLOWBLOCK_API UHLComposureComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UHLComposureComponent();

	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	/** Set whether the owner is currently standing in darkness (driven by the character). */
	UFUNCTION(BlueprintCallable, Category = "Composure")
	void SetInDarkness(bool bDark) { bInDarkness = bDark; }

	/** Set whether the presence is currently near / visible (driven by the presence AI). */
	UFUNCTION(BlueprintCallable, Category = "Composure")
	void SetPresenceNear(bool bNear) { bPresenceNear = bNear; }

	/** Directly subtract composure, e.g. for a scripted scare. Value is 0..1. */
	UFUNCTION(BlueprintCallable, Category = "Composure")
	void ApplyShock(float Amount);

	UFUNCTION(BlueprintPure, Category = "Composure")
	float GetComposurePercent() const { return Composure; }

	UPROPERTY(BlueprintAssignable, Category = "Composure")
	FOnComposureChanged OnComposureChanged;

	UPROPERTY(BlueprintAssignable, Category = "Composure")
	FOnComposureBroke OnComposureBroke;

protected:
	virtual void BeginPlay() override;

	/** Composure lost per second while standing in darkness. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Composure", meta = (ClampMin = "0.0"))
	float DarknessDrainPerSecond = 0.025f;

	/** Additional composure lost per second while the presence is near. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Composure", meta = (ClampMin = "0.0"))
	float PresenceDrainPerSecond = 0.08f;

	/** Composure recovered per second while safe (lit, no presence). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Composure", meta = (ClampMin = "0.0"))
	float RecoveryPerSecond = 0.04f;

private:
	void BroadcastComposure();

	UPROPERTY(Transient)
	float Composure = 1.f;

	bool bInDarkness = false;
	bool bPresenceNear = false;
	bool bHasBroken = false;
};
