// Copyright Hollow Block. All Rights Reserved.

#include "AI/HLPresenceActor.h"
#include "AI/HLPresenceController.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/AudioComponent.h"
#include "Materials/MaterialInstanceDynamic.h"

AHLPresenceActor::AHLPresenceActor()
{
	PrimaryActorTick.bCanEverTick = true;

	Mesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("Mesh"));
	RootComponent = Mesh;
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Mesh->SetVisibility(false);

	WatchCue = CreateDefaultSubobject<UAudioComponent>(TEXT("WatchCue"));
	WatchCue->SetupAttachment(Mesh);
	WatchCue->bAutoActivate = false;

	AIControllerClass = AHLPresenceController::StaticClass();
	AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
}

void AHLPresenceActor::BeginPlay()
{
	Super::BeginPlay();
	EnsureDynamicMaterials();
	ApplyOpacity(0.f);
	SetState(EHLPresenceState::Dormant);
}

void AHLPresenceActor::OpenAppearanceWindow(float Tension)
{
	if (State != EHLPresenceState::Dormant)
	{
		return;
	}

	if (AHLPresenceController* PC = Cast<AHLPresenceController>(GetController()))
	{
		// Controller finds a spot at the edge of the player's view; if it succeeds,
		// it teleports us there and calls Appear().
		PC->TryPlaceAtEdgeOfView(Tension);
	}
}

void AHLPresenceActor::Appear()
{
	if (State == EHLPresenceState::Dormant || State == EHLPresenceState::Retreating)
	{
		Mesh->SetVisibility(true);
		WatchTimer = MaxWatchTime;
		if (WatchCue && WatchCue->Sound)
		{
			WatchCue->Play();
		}
		SetState(EHLPresenceState::Appearing);
	}
}

void AHLPresenceActor::Retreat()
{
	if (State == EHLPresenceState::Appearing || State == EHLPresenceState::Watching)
	{
		SetState(EHLPresenceState::Retreating);
	}
}

void AHLPresenceActor::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	const float FadeStep = (FadeDuration > 0.f) ? DeltaSeconds / FadeDuration : 1.f;

	switch (State)
	{
	case EHLPresenceState::Appearing:
		FadeAlpha = FMath::Min(1.f, FadeAlpha + FadeStep);
		ApplyOpacity(FadeAlpha);
		if (FadeAlpha >= 1.f)
		{
			SetState(EHLPresenceState::Watching);
		}
		break;

	case EHLPresenceState::Watching:
		WatchTimer -= DeltaSeconds;
		if (WatchTimer <= 0.f)
		{
			Retreat();
		}
		break;

	case EHLPresenceState::Retreating:
		FadeAlpha = FMath::Max(0.f, FadeAlpha - FadeStep);
		ApplyOpacity(FadeAlpha);
		if (FadeAlpha <= 0.f)
		{
			Mesh->SetVisibility(false);
			if (WatchCue)
			{
				WatchCue->Stop();
			}
			SetState(EHLPresenceState::Dormant);
		}
		break;

	default:
		break;
	}
}

void AHLPresenceActor::SetState(EHLPresenceState NewState)
{
	if (State == NewState)
	{
		return;
	}
	State = NewState;
	OnStateChanged(State);
}

void AHLPresenceActor::EnsureDynamicMaterials()
{
	if (!Mesh || DynamicMaterials.Num() > 0)
	{
		return;
	}

	const int32 NumMaterials = Mesh->GetNumMaterials();
	DynamicMaterials.Reserve(NumMaterials);
	for (int32 i = 0; i < NumMaterials; ++i)
	{
		DynamicMaterials.Add(Mesh->CreateAndSetMaterialInstanceDynamic(i));
	}
}

void AHLPresenceActor::ApplyOpacity(float Opacity)
{
	for (UMaterialInstanceDynamic* MID : DynamicMaterials)
	{
		if (MID)
		{
			MID->SetScalarParameterValue(OpacityParameter, Opacity);
		}
	}
}
