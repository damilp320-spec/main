// Copyright Hollow Block. All Rights Reserved.

#include "Components/HLComposureComponent.h"

UHLComposureComponent::UHLComposureComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
}

void UHLComposureComponent::BeginPlay()
{
	Super::BeginPlay();
	Composure = 1.f;
	BroadcastComposure();
}

void UHLComposureComponent::ApplyShock(float Amount)
{
	Composure = FMath::Clamp(Composure - Amount, 0.f, 1.f);
	BroadcastComposure();
}

void UHLComposureComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	float Delta = 0.f;
	if (bInDarkness)
	{
		Delta -= DarknessDrainPerSecond * DeltaTime;
	}
	if (bPresenceNear)
	{
		Delta -= PresenceDrainPerSecond * DeltaTime;
	}
	if (!bInDarkness && !bPresenceNear)
	{
		Delta += RecoveryPerSecond * DeltaTime;
	}

	if (!FMath::IsNearlyZero(Delta))
	{
		const float Previous = Composure;
		Composure = FMath::Clamp(Composure + Delta, 0.f, 1.f);
		if (!FMath::IsNearlyEqual(Previous, Composure))
		{
			BroadcastComposure();
		}
	}

	if (Composure <= 0.f && !bHasBroken)
	{
		bHasBroken = true;
		OnComposureBroke.Broadcast();
	}
	else if (Composure > 0.25f)
	{
		// Re-arm once the player has recovered enough that another break is meaningful.
		bHasBroken = false;
	}
}

void UHLComposureComponent::BroadcastComposure()
{
	OnComposureChanged.Broadcast(Composure);
}
