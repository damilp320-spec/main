// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "HLFlickerLightComponent.generated.h"

class ULightComponent;

UENUM(BlueprintType)
enum class EHLFlickerStyle : uint8
{
	/** Subtle, mostly-on hum with rare dropouts — a tired fluorescent tube. */
	Fluorescent,
	/** Erratic stutter, used for stressed areas. */
	Faulty,
	/** Mostly off with brief surges — a dying bulb. */
	Dying
};

/**
 * Flickers one or more light components with a chosen style. Subscribes (via the
 * TensionDirector pushing SetForcedBlackout) to stage synchronized blackouts during
 * scare beats. Attach to any actor and assign the lights to drive in TargetLights,
 * or leave empty to auto-collect every ULightComponent on the owner.
 */
UCLASS(ClassGroup = (HollowBlock), meta = (BlueprintSpawnableComponent))
class HOLLOWBLOCK_API UHLFlickerLightComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UHLFlickerLightComponent();

	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	/** Force the lights fully off for a duration, regardless of flicker style. */
	UFUNCTION(BlueprintCallable, Category = "Flicker")
	void SetForcedBlackout(float Duration);

protected:
	virtual void BeginPlay() override;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Flicker")
	EHLFlickerStyle Style = EHLFlickerStyle::Fluorescent;

	/** Lights to drive. If empty, all ULightComponents on the owner are used. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Flicker")
	TArray<TObjectPtr<ULightComponent>> TargetLights;

	/** Base intensity used when fully on. Captured from the first light if zero. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Flicker", meta = (ClampMin = "0.0"))
	float OnIntensity = 0.f;

private:
	void CollectLights();
	void ApplyIntensity(float Intensity);
	float NextDelayForStyle() const;
	float OnChanceForStyle() const;

	float StateTimer = 0.f;
	float BlackoutRemaining = 0.f;
	bool bCurrentlyOn = true;
};
