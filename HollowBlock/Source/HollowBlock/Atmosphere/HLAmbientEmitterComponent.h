// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Components/SceneComponent.h"
#include "HLAmbientEmitterComponent.generated.h"

class USoundBase;
class UAudioComponent;

/**
 * The signature system of Hollow Block: an apartment "is alive" without people.
 * Place this on a prop or room marker and it plays a looping device bed (a TV
 * hiss, a fan, a fridge hum) plus occasional one-shots (a pipe knock, a kettle, a
 * washing machine cycling) at randomized intervals. It deliberately exposes NO
 * voice category — the rule of the game is machines run, people are gone.
 *
 * The AmbienceManager registers every emitter and scales their density/volume with
 * the global tension level, so the block grows quieter-but-wronger as dread rises.
 */
UCLASS(ClassGroup = (HollowBlock), meta = (BlueprintSpawnableComponent))
class HOLLOWBLOCK_API UHLAmbientEmitterComponent : public USceneComponent
{
	GENERATED_BODY()

public:
	UHLAmbientEmitterComponent();

	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	/** Scales how often one-shots fire and the loop bed volume. 0 = silent, 1 = normal. */
	UFUNCTION(BlueprintCallable, Category = "Ambience")
	void SetIntensity(float InIntensity);

	UFUNCTION(BlueprintPure, Category = "Ambience")
	float GetIntensity() const { return Intensity; }

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

	void ScheduleNextOneShot();

	/** Continuous device bed for this room (fan / fridge / TV static). May be null. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ambience")
	TObjectPtr<USoundBase> LoopingBed;

	/** Pool of incidental device sounds. One is chosen at random per trigger. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ambience")
	TArray<TObjectPtr<USoundBase>> OneShots;

	/** Min/max seconds between one-shot device sounds (scaled by intensity). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ambience", meta = (ClampMin = "0.5"))
	float MinInterval = 6.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ambience", meta = (ClampMin = "0.5"))
	float MaxInterval = 24.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ambience", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float BedBaseVolume = 0.6f;

private:
	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> BedAudio;

	float Intensity = 1.f;
	float OneShotCountdown = 0.f;
};
