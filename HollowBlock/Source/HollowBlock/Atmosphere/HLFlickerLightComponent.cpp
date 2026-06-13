// Copyright Hollow Block. All Rights Reserved.

#include "Atmosphere/HLFlickerLightComponent.h"
#include "Components/LightComponent.h"

UHLFlickerLightComponent::UHLFlickerLightComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
}

void UHLFlickerLightComponent::BeginPlay()
{
	Super::BeginPlay();

	if (TargetLights.Num() == 0)
	{
		CollectLights();
	}

	if (OnIntensity <= 0.f && TargetLights.Num() > 0 && TargetLights[0])
	{
		OnIntensity = TargetLights[0]->Intensity;
	}

	StateTimer = NextDelayForStyle();
}

void UHLFlickerLightComponent::CollectLights()
{
	if (AActor* Owner = GetOwner())
	{
		TArray<ULightComponent*> Found;
		Owner->GetComponents<ULightComponent>(Found);
		for (ULightComponent* Light : Found)
		{
			TargetLights.Add(Light);
		}
	}
}

void UHLFlickerLightComponent::SetForcedBlackout(float Duration)
{
	BlackoutRemaining = FMath::Max(BlackoutRemaining, Duration);
	bCurrentlyOn = false;
	ApplyIntensity(0.f);
}

void UHLFlickerLightComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	if (BlackoutRemaining > 0.f)
	{
		BlackoutRemaining -= DeltaTime;
		if (BlackoutRemaining > 0.f)
		{
			return; // Held dark.
		}
	}

	StateTimer -= DeltaTime;
	if (StateTimer <= 0.f)
	{
		bCurrentlyOn = FMath::FRand() < OnChanceForStyle();
		ApplyIntensity(bCurrentlyOn ? OnIntensity : 0.f);
		StateTimer = NextDelayForStyle();
	}
}

void UHLFlickerLightComponent::ApplyIntensity(float Intensity)
{
	for (ULightComponent* Light : TargetLights)
	{
		if (Light)
		{
			Light->SetIntensity(Intensity);
		}
	}
}

float UHLFlickerLightComponent::NextDelayForStyle() const
{
	switch (Style)
	{
	case EHLFlickerStyle::Faulty:
		return FMath::FRandRange(0.04f, 0.35f);
	case EHLFlickerStyle::Dying:
		return FMath::FRandRange(0.1f, 1.2f);
	case EHLFlickerStyle::Fluorescent:
	default:
		// Mostly steady, with the occasional brief stutter.
		return FMath::FRand() < 0.85f ? FMath::FRandRange(1.5f, 5.f) : FMath::FRandRange(0.05f, 0.15f);
	}
}

float UHLFlickerLightComponent::OnChanceForStyle() const
{
	switch (Style)
	{
	case EHLFlickerStyle::Faulty:
		return 0.6f;
	case EHLFlickerStyle::Dying:
		return 0.25f;
	case EHLFlickerStyle::Fluorescent:
	default:
		return 0.9f;
	}
}
