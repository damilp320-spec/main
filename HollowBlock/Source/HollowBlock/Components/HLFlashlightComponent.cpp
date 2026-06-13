// Copyright Hollow Block. All Rights Reserved.

#include "Components/HLFlashlightComponent.h"
#include "Components/SpotLightComponent.h"

UHLFlashlightComponent::UHLFlashlightComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
}

void UHLFlashlightComponent::BeginPlay()
{
	Super::BeginPlay();

	BatterySeconds = MaxBatterySeconds;
	ApplyLightState();
	BroadcastBattery();
}

void UHLFlashlightComponent::SetControlledLight(USpotLightComponent* InLight)
{
	ControlledLight = InLight;
	ApplyLightState();
}

bool UHLFlashlightComponent::ToggleFlashlight()
{
	if (!bIsOn && BatterySeconds <= 0.f)
	{
		return false;
	}

	SetFlashlightOn(!bIsOn);
	return true;
}

void UHLFlashlightComponent::SetFlashlightOn(bool bOn)
{
	if (bOn && BatterySeconds <= 0.f)
	{
		bOn = false;
	}

	if (bOn == bIsOn)
	{
		return;
	}

	bIsOn = bOn;
	ApplyLightState();
	OnFlashlightToggled.Broadcast(bIsOn);
}

void UHLFlashlightComponent::AddBattery(float Fraction)
{
	BatterySeconds = FMath::Clamp(BatterySeconds + Fraction * MaxBatterySeconds, 0.f, MaxBatterySeconds);
	BroadcastBattery();
}

void UHLFlashlightComponent::TriggerFlicker(float Duration)
{
	ForcedFlickerRemaining = FMath::Max(ForcedFlickerRemaining, Duration);
}

void UHLFlashlightComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	const float PrevBattery = BatterySeconds;

	if (bIsOn)
	{
		BatterySeconds = FMath::Max(0.f, BatterySeconds - DeltaTime);
		if (BatterySeconds <= 0.f)
		{
			SetFlashlightOn(false);
		}
	}
	else
	{
		BatterySeconds = FMath::Min(MaxBatterySeconds, BatterySeconds + RechargePerSecond * DeltaTime);
	}

	if (!FMath::IsNearlyEqual(PrevBattery, BatterySeconds))
	{
		BroadcastBattery();
	}

	// Flicker logic: forced flicker (scare) or low-battery flicker.
	const bool bLowBattery = GetBatteryPercent() <= LowBatteryFlickerThreshold;
	const bool bShouldFlicker = bIsOn && (ForcedFlickerRemaining > 0.f || bLowBattery);

	if (ForcedFlickerRemaining > 0.f)
	{
		ForcedFlickerRemaining = FMath::Max(0.f, ForcedFlickerRemaining - DeltaTime);
	}

	if (bShouldFlicker)
	{
		FlickerTimer -= DeltaTime;
		if (FlickerTimer <= 0.f)
		{
			bFlickerVisibleState = !bFlickerVisibleState;
			FlickerTimer = FMath::FRandRange(0.03f, 0.12f);
			ApplyLightState();
		}
	}
	else if (!bFlickerVisibleState)
	{
		// Restore steady state once flicker conditions pass.
		bFlickerVisibleState = true;
		ApplyLightState();
	}
}

void UHLFlashlightComponent::ApplyLightState()
{
	if (!ControlledLight)
	{
		return;
	}

	const bool bVisible = bIsOn && bFlickerVisibleState;
	ControlledLight->SetVisibility(bVisible);
	ControlledLight->SetIntensity(bVisible ? OnIntensity : 0.f);
}

void UHLFlashlightComponent::BroadcastBattery()
{
	OnBatteryChanged.Broadcast(GetBatteryPercent());
}
