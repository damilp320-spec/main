// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "HLPresenceActor.generated.h"

class USkeletalMeshComponent;
class UAudioComponent;

UENUM(BlueprintType)
enum class EHLPresenceState : uint8
{
	Dormant,
	Appearing,
	Watching,
	Retreating
};

/**
 * The presence — Hollow Block's source of fear. It is NOT a combat enemy and never
 * damages the player. When the TensionDirector opens a window, it materializes at a
 * chosen vantage point at the edge of sight (down a corridor, in a doorway), watches,
 * and then vanishes the instant the player looks straight at it or moves too close.
 * Pure psychological dread: you are never sure you saw anything.
 *
 * Spawn placement and the look/approach checks are driven by AHLPresenceController.
 */
UCLASS()
class HOLLOWBLOCK_API AHLPresenceActor : public AActor
{
	GENERATED_BODY()

public:
	AHLPresenceActor();

	virtual void Tick(float DeltaSeconds) override;

	/** Called by the TensionDirector. Asks the controller to place + reveal the presence. */
	UFUNCTION(BlueprintCallable, Category = "Presence")
	void OpenAppearanceWindow(float Tension);

	/** Begin a fade-in at the current location. */
	UFUNCTION(BlueprintCallable, Category = "Presence")
	void Appear();

	/** Begin a fade-out; once hidden, returns to Dormant. */
	UFUNCTION(BlueprintCallable, Category = "Presence")
	void Retreat();

	UFUNCTION(BlueprintPure, Category = "Presence")
	EHLPresenceState GetState() const { return State; }

	UFUNCTION(BlueprintPure, Category = "Presence")
	bool IsVisibleToPlayer() const { return State == EHLPresenceState::Appearing || State == EHLPresenceState::Watching; }

	/** Blueprint hook so designers can layer VFX / stingers on each transition. */
	UFUNCTION(BlueprintImplementableEvent, Category = "Presence")
	void OnStateChanged(EHLPresenceState NewState);

protected:
	virtual void BeginPlay() override;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Presence")
	TObjectPtr<USkeletalMeshComponent> Mesh;

	/** Subtle directional cue (a breath, a low hum) that plays while watching. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Presence")
	TObjectPtr<UAudioComponent> WatchCue;

	/** Seconds to fade in/out the mesh opacity (driven via a dynamic material param). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Presence", meta = (ClampMin = "0.0"))
	float FadeDuration = 0.6f;

	/** Max seconds the presence will linger before retreating on its own. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Presence", meta = (ClampMin = "0.0"))
	float MaxWatchTime = 5.f;

	/** Name of the scalar material parameter used to drive visibility/opacity. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Presence")
	FName OpacityParameter = TEXT("Opacity");

private:
	void SetState(EHLPresenceState NewState);
	void ApplyOpacity(float Opacity);
	void EnsureDynamicMaterials();

	UPROPERTY(Transient)
	TArray<TObjectPtr<UMaterialInstanceDynamic>> DynamicMaterials;

	EHLPresenceState State = EHLPresenceState::Dormant;
	float FadeAlpha = 0.f;     // 0 = invisible, 1 = fully present
	float WatchTimer = 0.f;
};
