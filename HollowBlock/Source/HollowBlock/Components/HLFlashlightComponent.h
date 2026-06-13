// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "HLFlashlightComponent.generated.h"

class USpotLightComponent;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnFlashlightToggled, bool, bIsOn);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBatteryChanged, float, BatteryPercent);

/**
 * Drives a handheld flashlight: on/off toggle, battery drain while on and slow
 * recharge while off, plus optional flicker when the battery is low or when the
 * TensionDirector forces a scare. Designed to drive a SpotLightComponent that is
 * assigned in the owning actor (set via SetControlledLight or in Blueprint).
 */
UCLASS(ClassGroup = (HollowBlock), meta = (BlueprintSpawnableComponent))
class HOLLOWBLOCK_API UHLFlashlightComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UHLFlashlightComponent();

	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	/** Turn the light on/off. No effect (returns false) if battery is empty. */
	UFUNCTION(BlueprintCallable, Category = "Flashlight")
	bool ToggleFlashlight();

	UFUNCTION(BlueprintCallable, Category = "Flashlight")
	void SetFlashlightOn(bool bOn);

	/** Assign the spotlight this component should drive (e.g. a child of the camera). */
	UFUNCTION(BlueprintCallable, Category = "Flashlight")
	void SetControlledLight(USpotLightComponent* InLight);

	/** Add battery charge, 0..1 fraction of max (e.g. picking up a battery item). */
	UFUNCTION(BlueprintCallable, Category = "Flashlight")
	void AddBattery(float Fraction);

	UFUNCTION(BlueprintPure, Category = "Flashlight")
	float GetBatteryPercent() const { return MaxBatterySeconds > 0.f ? BatterySeconds / MaxBatterySeconds : 0.f; }

	UFUNCTION(BlueprintPure, Category = "Flashlight")
	bool IsOn() const { return bIsOn; }

	/** Force a short flicker burst (called by the TensionDirector for scares). */
	UFUNCTION(BlueprintCallable, Category = "Flashlight")
	void TriggerFlicker(float Duration);

	UPROPERTY(BlueprintAssignable, Category = "Flashlight")
	FOnFlashlightToggled OnFlashlightToggled;

	UPROPERTY(BlueprintAssignable, Category = "Flashlight")
	FOnBatteryChanged OnBatteryChanged;

protected:
	virtual void BeginPlay() override;

	/** Total battery capacity expressed in seconds of continuous use. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Flashlight", meta = (ClampMin = "1.0"))
	float MaxBatterySeconds = 240.f;

	/** Seconds of charge regained per real second while the light is off. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Flashlight", meta = (ClampMin = "0.0"))
	float RechargePerSecond = 4.f;

	/** Battery fraction below which the light starts flickering on its own. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Flashlight", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float LowBatteryFlickerThreshold = 0.15f;

	/** Light intensity used when the flashlight is fully on. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Flashlight", meta = (ClampMin = "0.0"))
	float OnIntensity = 5000.f;

private:
	void ApplyLightState();
	void BroadcastBattery();

	UPROPERTY(Transient)
	TObjectPtr<USpotLightComponent> ControlledLight;

	bool bIsOn = false;
	float BatterySeconds = 0.f;
	float ForcedFlickerRemaining = 0.f;
	float FlickerTimer = 0.f;
	bool bFlickerVisibleState = true;
};
