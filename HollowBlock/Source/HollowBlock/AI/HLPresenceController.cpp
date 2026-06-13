// Copyright Hollow Block. All Rights Reserved.

#include "AI/HLPresenceController.h"
#include "AI/HLPresenceActor.h"
#include "NavigationSystem.h"
#include "GameFramework/Pawn.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/World.h"

AHLPresenceController::AHLPresenceController()
{
	PrimaryActorTick.bCanEverTick = true;
}

AHLPresenceActor* AHLPresenceController::GetPresence() const
{
	return Cast<AHLPresenceActor>(GetPawn());
}

bool AHLPresenceController::TryPlaceAtEdgeOfView(float Tension)
{
	AHLPresenceActor* Presence = GetPresence();
	APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!Presence || !Player)
	{
		return false;
	}

	const FVector PlayerLoc = Player->GetActorLocation();
	const FRotator ViewRot = Player->GetControlRotation();
	const FVector ViewDir = ViewRot.Vector().GetSafeNormal2D();

	// Offset to either side of the player's gaze so the presence sits in peripheral view.
	const float Side = FMath::RandBool() ? 1.f : -1.f;
	const FVector PlaceDir = ViewDir.RotateAngleAxis(Side * PlacementOffsetAngle, FVector::UpVector);
	const FVector Desired = PlayerLoc + PlaceDir * PlacementDistance;

	// Snap to the navmesh so it lands on walkable floor rather than inside geometry.
	FVector Target = Desired;
	if (UNavigationSystemV1* Nav = UNavigationSystemV1::GetCurrent(GetWorld()))
	{
		FNavLocation NavLoc;
		if (Nav->ProjectPointToNavigation(Desired, NavLoc, FVector(300.f, 300.f, 400.f)))
		{
			Target = NavLoc.Location;
		}
	}

	// Require line of sight from the player's eyes, else the reveal is wasted behind a wall.
	FHitResult Hit;
	const FVector EyeLoc = PlayerLoc + FVector(0.f, 0.f, 60.f);
	FCollisionQueryParams Params;
	Params.AddIgnoredActor(Player);
	Params.AddIgnoredActor(Presence);
	const bool bBlocked = GetWorld()->LineTraceSingleByChannel(Hit, EyeLoc, Target + FVector(0.f, 0.f, 60.f), ECC_Visibility, Params);
	if (bBlocked)
	{
		return false;
	}

	// Face the player and reveal.
	const FRotator FacePlayer = (PlayerLoc - Target).GetSafeNormal2D().Rotation();
	Presence->SetActorLocationAndRotation(Target, FacePlayer);
	Presence->Appear();
	return true;
}

void AHLPresenceController::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	AHLPresenceActor* Presence = GetPresence();
	if (!Presence || !Presence->IsVisibleToPlayer())
	{
		return;
	}

	APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!Player)
	{
		return;
	}

	const FVector PresenceLoc = Presence->GetActorLocation();
	const float Dist = FVector::Dist(Player->GetActorLocation(), PresenceLoc);

	// Vanish if looked at directly or approached too closely — that's the whole trick.
	if (Dist <= RetreatDistance || IsPlayerLookingAt(PresenceLoc, Player))
	{
		Presence->Retreat();
	}
}

bool AHLPresenceController::IsPlayerLookingAt(const FVector& Location, const APawn* PlayerPawn) const
{
	if (!PlayerPawn)
	{
		return false;
	}

	const FVector EyeLoc = PlayerPawn->GetActorLocation() + FVector(0.f, 0.f, 60.f);
	const FVector ToTarget = (Location - EyeLoc).GetSafeNormal();
	const FVector ViewDir = PlayerPawn->GetControlRotation().Vector();

	const float Dot = FVector::DotProduct(ViewDir, ToTarget);
	const float AngleDeg = FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(Dot, -1.f, 1.f)));
	return AngleDeg <= DirectLookAngle;
}
